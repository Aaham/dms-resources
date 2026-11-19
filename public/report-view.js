// A submitted scorecard as HTML. Used by the visitor's results and the staff view.
import { h } from './common.js';

export function summaryHtml(report, definition) {
  const r = report.result;
  return `<div class="score-summary"><div><p class="score-label">Readiness score</p><p class="score-number">${r.total}<span>/ 40</span></p></div>` +
    `<div class="score-band"><h2>${h(r.band.name)}</h2><p>${h(r.band.action)}</p></div>` +
    `<div class="band-scale" aria-label="Score levels">${definition.bands.map((b) => `<div ${r.band.name === b.name ? 'aria-current="true"' : ''}><strong>${h(b.name)}</strong><span>${b.min}–${b.max}</span></div>`).join('')}</div></div>`;
}

export function detailHtml(report, definition) {
  const r = report.result;
  const scale = definition.scale;
  const steps = r.priorities.length ? r.priorities.map((p) => p.action) : [definition.feedback.followUp];
  const hasConversation = Object.values(report.conversation || {}).some(Boolean);

  return `<div class="result-grid">` +
      `<section class="domain-results" aria-labelledby="domain-title"><h2 id="domain-title">Scores by area</h2>` +
        r.domains.map((d) => `<div class="domain-bar"><div class="domain-bar-label"><span>${h(d.title)}</span><strong>${d.score} / 8</strong></div>` +
          `<div class="meter-track" role="meter" aria-label="${h(d.title)}" aria-valuemin="0" aria-valuemax="8" aria-valuenow="${d.score}"><div class="meter-fill" data-fill="${d.score / 8 * 100}"></div></div></div>`).join('') +
      `</section>` +
      `<section class="next-actions" aria-labelledby="next-title"><h2 id="next-title">Next steps</h2><ol class="priority-list">${steps.map((s) => `<li>${h(s)}</li>`).join('')}</ol></section>` +
    `</div>` +
    `<section class="critical-section" aria-labelledby="critical-title"><h2 id="critical-title">Critical gaps</h2><div>` +
      `<p class="critical-intro">${h(r.criticalGaps.length ? definition.feedback.gaps : definition.feedback.noGaps)}</p>` +
      `<ul class="critical-list">${r.criticalGaps.map((g) => `<li>${h(g.reason)}<small>Statement ${g.id} · No / unknown</small></li>`).join('')}</ul>` +
    `</div></section>` +
    `<section class="answer-record" aria-labelledby="answers-title"><div class="section-title"><h2 id="answers-title">Answers and notes</h2><span>0 = No / unknown · 1 = Partly · 2 = Yes</span></div>` +
      definition.domains.map((d) => `<details class="answer-domain"><summary>${h(d.title)}<strong>${r.domains.find((v) => v.id === d.id).score} / 8</strong></summary>` +
        `<ul>${d.questions.map((q) => `<li><span>${q.id}. ${h(q.statement)}</span><strong aria-label="${h(scale[report.answers[q.id - 1]].label)}">${report.answers[q.id - 1]}</strong></li>`).join('')}</ul>` +
        (report.notes[d.id] ? `<p class="saved-note"><strong>Notes</strong><br>${h(report.notes[d.id])}</p>` : '') + `</details>`).join('') +
    `</section>` +
    (hasConversation ? `<section class="conversation-record" aria-labelledby="conversation-title"><h2 id="conversation-title">Team discussion notes</h2><dl>` +
      definition.conversation.map((q) => `<div><dt>${h(q.label)}</dt><dd>${h(report.conversation[q.id] || 'Not recorded')}</dd></div>`).join('') +
    `</dl></section>` : '');
}

/* Bar widths are set here, not in a style attribute, so the page works under a
   Content-Security-Policy that blocks inline styles. */
export function fillMeters(root) {
  root.querySelectorAll('[data-fill]').forEach((el) => { el.style.width = `${el.dataset.fill}%`; });
}

/* Collapsed answer sections print open, then return to how they were. */
export function printWithAnswersOpen() {
  let closed = [];
  window.addEventListener('beforeprint', () => {
    closed = [...document.querySelectorAll('.answer-domain')].filter((d) => !d.open);
    closed.forEach((d) => { d.open = true; });
  });
  window.addEventListener('afterprint', () => { closed.forEach((d) => { d.open = false; }); });
}
