/* =============================================================================
   Who has entered an email address
   -----------------------------------------------------------------------------
   DATA_DIR/visitors.jsonl is the record, one JSON object per line:

     { "type": "visit",   "vid": "...", "email": "...", "at": "...", "event": "njsba-2026" }
     { "type": "email",   "vid": "...", "email": "...", "at": "..." }   the address was corrected

   A visit is one browser that entered an address. The same person on a second
   device is a second visit with the same address. The staff view groups visits
   by address.

   The addresses are as typed. Nothing confirms that the person entering an
   address can read its inbox.

   `event` comes from the ?event= tag on the link a QR code points to, and says
   which flyer or session brought the visitor. It is optional.

   Appends are serialized and the maps are in memory, which is correct for one
   running copy of the server. Running two needs a database instead.
   ============================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

const visits = new Map();   // vid -> { vid, email, firstSeenAt, lastSeenAt, events }
let queue = Promise.resolve();

const file = () => path.join(env.server.dataDir, 'visitors.jsonl');

/* Lowercase letters, digits and hyphens, so a tag is safe in a URL, a CSV cell
   and a table without escaping. Anything else is dropped, not rejected: a bad
   tag must never stop someone opening the resources. */
export function cleanEvent(value) {
  if (typeof value !== 'string') return '';
  const tag = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(tag) ? tag : '';
}

function apply(entry) {
  const { type, vid, email, at } = entry;
  if (typeof email !== 'string' || !email || !Number.isFinite(Date.parse(at))) return;
  if (typeof vid !== 'string' || !vid || !['visit', 'email'].includes(type)) return;
  const visit = visits.get(vid) || { vid, email, firstSeenAt: at, lastSeenAt: at, events: [] };
  visit.email = email;
  if (at < visit.firstSeenAt) visit.firstSeenAt = at;
  if (at > visit.lastSeenAt) visit.lastSeenAt = at;
  const tag = cleanEvent(entry.event);
  if (tag && !visit.events.includes(tag)) visit.events.push(tag);
  visits.set(vid, visit);
}

export function initVisitors() {
  visits.clear();
  let skipped = 0;
  try {
    for (const line of fs.readFileSync(file(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { apply(JSON.parse(line)); } catch { skipped += 1; }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (skipped) console.warn(`[visitors] skipped ${skipped} unreadable line(s) in ${file()}`);
  return { visitors: listVisitors().length };
}

function record(entry) {
  apply(entry);
  queue = queue.catch(() => {}).then(async () => {
    await fs.promises.mkdir(env.server.dataDir, { recursive: true, mode: 0o700 });
    await fs.promises.appendFile(file(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  });
  return queue;
}

const now = () => new Date().toISOString();

export const recordVisit = ({ vid, email, event }) =>
  record({ type: 'visit', vid, email, at: now(), event: cleanEvent(event) || undefined });
export const recordEmailChange = (vid, email) => record({ type: 'email', vid, email, at: now() });

/* One row per address, most recent visit first. */
export function listVisitors() {
  const byEmail = new Map();
  for (const visit of visits.values()) {
    const row = byEmail.get(visit.email) || { email: visit.email, firstSeenAt: visit.firstSeenAt,
      lastSeenAt: visit.lastSeenAt, visits: 0, events: [], vids: [] };
    row.visits += 1;
    row.vids.push(visit.vid);
    if (visit.firstSeenAt < row.firstSeenAt) row.firstSeenAt = visit.firstSeenAt;
    if (visit.lastSeenAt > row.lastSeenAt) row.lastSeenAt = visit.lastSeenAt;
    for (const tag of visit.events) if (!row.events.includes(tag)) row.events.push(tag);
    byEmail.set(visit.email, row);
  }
  return [...byEmail.values()].sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0));
}

export const visitsFor = (email) => [...visits.values()].filter((visit) => visit.email === email).map((visit) => visit.vid);
