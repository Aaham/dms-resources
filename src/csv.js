/* Every value written to a CSV here was typed by a visitor. A cell that begins
   =, +, - or @ runs as a formula when the file is opened in Excel, Google
   Sheets or LibreOffice, so those cells are prefixed with an apostrophe. */
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const SCORECARD_STATUS = { completed: 'Completed', not_completed: 'Not completed', unavailable: 'Could not be read' };

export const VISITOR_COLUMNS = [
  ['Email', (v) => v.email],
  ['First visit', (v) => v.firstSeenAt],
  ['Last visit', (v) => v.lastSeenAt],
  ['Visits', (v) => v.visits],
  ['Event', (v) => v.events.join(' ')],
  ['AI scorecard', (v) => SCORECARD_STATUS[v.scorecard?.status] || ''],
  ['Score', (v) => (v.scorecard?.status === 'completed' ? v.scorecard.score : '')],
  ['Out of', (v) => (v.scorecard?.status === 'completed' ? v.scorecard.max : '')],
  ['Level', (v) => (v.scorecard?.status === 'completed' ? v.scorecard.level : '')],
  ['Scorecard completed', (v) => (v.scorecard?.status === 'completed' ? v.scorecard.completedAt : '')],
];

export function visitorsCsv(rows) {
  const lines = [VISITOR_COLUMNS.map(([head]) => csvCell(head)).join(',')];
  for (const row of rows) lines.push(VISITOR_COLUMNS.map(([, read]) => csvCell(read(row))).join(','));
  // The BOM makes Excel on Windows read the file as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}
