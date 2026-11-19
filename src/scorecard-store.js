import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { env } from './env.js';
import { validVisitId } from './access.js';
import { DOMAINS } from './scorecard-content.js';

/* One file per visit, holding the latest scorecard submitted from that browser.
   A visit id is a random UUID that only the visitor's cookie and report email
   carry, so knowing someone's address is not enough to read their scorecard. */
const locks = new Map();
const questions = new Map(DOMAINS.flatMap((domain) => domain.questions).map((question) => [question.id, question]));
function fileFor(vid) {
  if (!validVisitId(vid)) throw new Error('Not a visit id.');
  return path.join(env.server.dataDir, 'scorecards', `${vid}.json`);
}

// Like the visitor list, this is for a single server instance.
export async function withReportLock(vid, task) {
  const previous = locks.get(vid) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  locks.set(vid, next);
  try { return await next; }
  finally { if (locks.get(vid) === next) locks.delete(vid); }
}

export async function readReport(vid) {
  try {
    const report = JSON.parse(await fs.readFile(fileFor(vid), 'utf8'));
    // Show current wording on saved reports without changing answers or scores.
    for (const gap of report.result?.criticalGaps || []) {
      const question = questions.get(gap.id);
      if (question) Object.assign(gap, { reason: question.critical, action: question.action });
    }
    for (const priority of report.result?.priorities || []) {
      const question = questions.get(priority.id);
      if (question) priority.action = question.action;
    }
    return report;
  }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

export async function saveReport(vid, report) {
  const file = fileFor(vid);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(report), { mode: 0o600 });
    await fs.rename(temp, file);
  } finally { await fs.rm(temp, { force: true }); }
}
