// Report text, CSV and email, carried over from the webinar scorecard.
import { DOMAINS, SCALE, CONVERSATION, FEEDBACK } from './scorecard-content.js';
import { csvCell } from './csv.js';
import { emailLayout, emailButton, emailLogoAttachment, emailFooterText, escapeEmailHtml as escapeHtml } from './email-layout.js';

export { escapeHtml };

export function reportText(report) {
  const r = report.result;
  return [
    'DMS AI Readiness Report',
    `Email: ${report.email}`,
    `Completed: ${report.createdAt.slice(0, 10)}`,
    `Score: ${r.total} / 40 | ${r.band.name}`,
    r.band.action, '',
    ...r.domains.map((d) => `${d.title}: ${d.score} / 8`), '',
    'Critical gaps',
    ...(r.criticalGaps.length ? [FEEDBACK.gaps, ...r.criticalGaps.map((g) => `Statement ${g.id}: ${g.reason}`)] : [FEEDBACK.noGaps]), '',
    'Next steps', ...(r.priorities.length ? r.priorities.map((p) => p.action) : [FEEDBACK.followUp]), '',
    'Answers & notes',
    ...DOMAINS.flatMap((d) => [d.title, ...d.questions.map((q) => `${q.id}. ${q.statement}\n${report.answers[q.id - 1]} — ${SCALE[report.answers[q.id - 1]].label}`),
      ...(report.notes[d.id] ? [`Notes: ${report.notes[d.id]}`] : []), '']),
    ...(Object.values(report.conversation).some(Boolean) ? ['Team discussion notes',
      ...CONVERSATION.map((q) => `${q.label}: ${report.conversation[q.id] || 'Not recorded'}`)] : []),
  ].join('\n');
}

export function reportCsv(report) {
  const rows = [
    ['DMS AI Readiness Report'], ['Email', report.email], ['Completed', report.createdAt],
    ['Score', report.result.total, 'Out of', 40], ['Level', report.result.band.name],
    ['Management action', report.result.band.action], [],
    ['Area', 'Statement', 'Answer', 'Score'],
    ...DOMAINS.flatMap((d) => [...d.questions.map((q) => [d.title, q.statement, SCALE[report.answers[q.id - 1]].label, report.answers[q.id - 1]]),
      [d.title, 'Notes', report.notes[d.id]]]), [],
    ['Area', 'Score', 'Out of'], ...report.result.domains.map((d) => [d.title, d.score, 8]), [],
    ['Critical gaps', 'Action'], ...(report.result.criticalGaps.length
      ? report.result.criticalGaps.map((g) => [g.reason, g.action]) : [[FEEDBACK.noGaps]]), [],
    ['Next steps'], ...(report.result.priorities.length
      ? report.result.priorities.map((p) => [p.action]) : [[FEEDBACK.followUp]]), [],
    ...(Object.values(report.conversation).some(Boolean) ? [['Team discussion notes', 'Answer'],
      ...CONVERSATION.map((q) => [q.label, report.conversation[q.id]])] : []),
  ];
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function reportEmail(report, scorecardUrl = '') {
  const r = report.result;
  const h = escapeHtml;
  const completed = new Date(report.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const html = emailLayout({ title: 'Your DMS AI readiness report',
    preheader: `${r.total} out of 40 — ${r.band.name}. Your report is attached.`, body: `
    <tr><td class="email-padding" style="padding:28px 32px;">
      <h1 class="email-title" style="margin:0 0 10px;font-size:30px;font-weight:700;line-height:38px;letter-spacing:-0.5px;">Your AI readiness score</h1>
      <p style="margin:0;color:#55637A;font-size:13px;line-height:21px;">Completed ${h(completed)}</p>
    </td></tr>
    <tr><td class="email-padding" bgcolor="#0E2135" style="padding:32px;background-color:#0E2135;color:#ffffff;">
      <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
        <td class="score-cell" width="176" valign="middle" style="width:176px;padding:0 24px 0 0;vertical-align:middle;">
          <p style="margin:0;color:#ffffff;font-size:72px;font-weight:700;line-height:80px;letter-spacing:-3px;">${r.total}<span style="font-size:22px;font-weight:400;letter-spacing:0;"> / 40</span></p>
        </td>
        <td class="score-description" valign="middle" style="vertical-align:middle;">
          <h2 style="margin:0 0 10px;color:#ffffff;font-size:26px;font-weight:700;line-height:32px;">${h(r.band.name)}</h2>
          <p style="margin:0;color:#ffffff;font-size:15px;line-height:24px;">${h(r.band.action)}</p>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="email-padding" style="padding:28px 32px;">
      <p style="margin:0${scorecardUrl ? ' 0 20px' : ''};font-size:15px;line-height:24px;color:#55637A;">Your report is attached as CSV and text files, including your answers and notes.</p>
      ${scorecardUrl ? emailButton(scorecardUrl, 'Open your scorecard') : ''}
    </td></tr>
    <tr><td class="email-padding" style="padding:28px 32px;border-top:1px solid #DBE1E8;">
      <h2 style="margin:0 0 12px;font-size:21px;font-weight:700;line-height:28px;">Scores by area</h2>
      <table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">
        <thead><tr><th scope="col" align="left" style="padding:0 12px 8px 0;border-bottom:1px solid #DBE1E8;color:#55637A;font-size:12px;font-weight:400;line-height:20px;">Area</th><th scope="col" align="right" style="padding:0 0 8px;border-bottom:1px solid #DBE1E8;color:#55637A;font-size:12px;font-weight:400;line-height:20px;">Score</th></tr></thead>
        <tbody>${r.domains.map((d) => `<tr>
          <th scope="row" align="left" style="padding:14px 16px 14px 0;border-bottom:1px solid #DBE1E8;color:#0E2135;font-size:14px;font-weight:400;line-height:22px;">${h(d.title)}</th>
          <td align="right" style="padding:14px 0;border-bottom:1px solid #DBE1E8;color:#0E2135;font-family:'Courier New',monospace;font-size:15px;font-weight:700;line-height:22px;white-space:nowrap;">${d.score} / 8</td>
        </tr>`).join('')}</tbody>
      </table>
    </td></tr>
    <tr><td class="email-padding" style="padding:0 32px 28px;">
      <h2 style="margin:0 0 12px;font-size:21px;font-weight:700;line-height:28px;">Critical gaps</h2>
      <p style="margin:0;font-size:15px;line-height:24px;color:#55637A;">${h(r.criticalGaps.length ? FEEDBACK.gaps : FEEDBACK.noGaps)}</p>
      ${r.criticalGaps.length ? `<ul style="margin:16px 0 0;padding-left:20px;color:#0E2135;font-size:15px;line-height:24px;">${r.criticalGaps.map((g) => `<li style="margin-bottom:12px;">${h(g.reason)} <span style="color:#55637A;font-size:12px;">(Statement ${g.id})</span></li>`).join('')}</ul>` : ''}
    </td></tr>
    <tr><td class="email-padding" style="padding:0 32px 32px;">
      <h2 style="margin:0 0 12px;font-size:21px;font-weight:700;line-height:28px;">Next steps</h2>
      <ol style="margin:0;padding-left:20px;color:#0E2135;font-size:15px;line-height:24px;">${(r.priorities.length ? r.priorities.map((p) => p.action) : [FEEDBACK.followUp]).map((a) => `<li style="margin-bottom:12px;padding-left:4px;">${h(a)}</li>`).join('')}</ol>
    </td></tr>` });
  return { subject: `Your DMS AI readiness score: ${r.total}/40 — ${r.band.name}`, text: reportText(report) +
    '\n\nYour report is attached as CSV and text files, including your answers and notes.' +
    (scorecardUrl ? `\n\nOpen your scorecard to review or update your answers: ${scorecardUrl}` : '') + `\n\n${emailFooterText}`, html,
    attachments: [{ filename: `dms-ai-readiness-${report.createdAt.slice(0, 10)}.csv`, content: reportCsv(report), contentType: 'text/csv; charset=utf-8' },
      { filename: `dms-ai-readiness-${report.createdAt.slice(0, 10)}.txt`, content: reportText(report), contentType: 'text/plain; charset=utf-8' },
      emailLogoAttachment()] };
}
