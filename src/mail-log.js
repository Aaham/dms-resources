/* =============================================================================
   Every email the site has sent, and the limits that depend on that record
   -----------------------------------------------------------------------------
   DATA_DIR/mail.jsonl has one line per email handed to Brevo:

     { "kind": "links" | "report" | "staff" | "notice", "email": "...", "at": "..." }

   The record is on disk because two of the limits must outlast a restart: the
   daily cap that protects the shared Brevo allowance, and the five-ever limit
   per address.

   Per address (an address is emailed as it was typed, and nothing confirms
   who typed it, so these keep the form from being used to mail someone again
   and again):

     links    one a day, five ever
     report   one a day, five ever
     staff    one every two minutes, six a day

   Addresses in UNLIMITED_EMAILS are exempt from all three, for testing. The
   site-wide caps in mailer.js still apply to them.
   ============================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

const DAY_MS = 24 * 60 * 60_000;
const RULES = {
  links: { perDay: 1, ever: 5 },
  report: { perDay: 1, ever: 5 },
  staff: { perDay: 6, waitMs: 2 * 60_000 },
};

let recent = [];           // { at, kind, email } from the last 24 hours
const totals = new Map();  // `${kind}:${email}` -> { count, lastAt }
let queue = Promise.resolve();

const file = () => path.join(env.server.dataDir, 'mail.jsonl');

function apply({ kind, email, at }) {
  const time = Date.parse(at);
  if (typeof kind !== 'string' || typeof email !== 'string' || !Number.isFinite(time)) return;
  const key = `${kind}:${email}`;
  const total = totals.get(key) || { count: 0, lastAt: 0 };
  totals.set(key, { count: total.count + 1, lastAt: Math.max(total.lastAt, time) });
  recent.push({ at: time, kind, email });
}

function prune() {
  const cutoff = Date.now() - DAY_MS;
  recent = recent.filter((entry) => entry.at > cutoff);
}

export function initMailLog() {
  recent = [];
  totals.clear();
  try {
    for (const line of fs.readFileSync(file(), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { apply(JSON.parse(line)); } catch { /* An unreadable line is skipped. */ }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  prune();
  return { sentInLastDay: recent.length };
}

export function recordMail(kind, email) {
  const entry = { kind, email, at: new Date().toISOString() };
  apply(entry);
  queue = queue.catch(() => {}).then(async () => {
    await fs.promises.mkdir(env.server.dataDir, { recursive: true, mode: 0o700 });
    await fs.promises.appendFile(file(), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  });
  return queue;
}

/* Emails sent in the last 24 hours: of one kind, or of every kind. */
export function mailInLastDay(kind) {
  prune();
  return kind ? recent.filter((entry) => entry.kind === kind).length : recent.length;
}

export const isUnlimited = (email) => env.mail.unlimited.includes(email);

/* May this kind of email go to this address now?
   { allowed: true } or { allowed: false, reason: 'daily' | 'lifetime' | 'wait' } */
export function allowance(kind, email) {
  if (isUnlimited(email)) return { allowed: true };
  const rule = RULES[kind];
  const total = totals.get(`${kind}:${email}`) || { count: 0, lastAt: 0 };
  if (rule.ever && total.count >= rule.ever) return { allowed: false, reason: 'lifetime' };
  if (rule.waitMs && Date.now() - total.lastAt < rule.waitMs) return { allowed: false, reason: 'wait' };
  prune();
  const today = recent.filter((entry) => entry.kind === kind && entry.email === email).length;
  return today >= rule.perDay ? { allowed: false, reason: 'daily' } : { allowed: true };
}
