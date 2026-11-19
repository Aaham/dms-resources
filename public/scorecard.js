import { $, h, api, message, busyButton, longDate, draftKey, clearDraft, goToEmailForm, loadVisit } from './common.js';
import { summaryHtml, detailHtml, fillMeters, printWithAnswersOpen } from './report-view.js';

const state = { email: '', definition: null, answers: Array(20).fill(null), notes: {}, conversation: {},
  step: 0, submissionId: crypto.randomUUID(), report: null, mail: { allowed: true }, busy: false };

function handleError(err, id = 'workspace-message') {
  if (err.status === 401) goToEmailForm();
  else message(id, err.message, true);
}

/* The draft stays in this browser, so someone who is interrupted can come back
   to it. It is removed when the scorecard is submitted and when the visitor
   switches to a different email address. */
function saveDraft() {
  try {
    localStorage.setItem(draftKey(state.email), JSON.stringify({ answers: state.answers, notes: state.notes,
      conversation: state.conversation, step: state.step, submissionId: state.submissionId }));
    $('draft-status').textContent = 'Draft saved in this browser.';
  } catch { $('draft-status').textContent = 'Keep this page open; this browser cannot save your draft.'; }
}
function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(draftKey(state.email)));
    if (!draft || !Array.isArray(draft.answers) || draft.answers.length !== 20 ||
        !draft.answers.every((a) => a === null || [0, 1, 2].includes(a))) return null;
    return { answers: draft.answers,
      notes: Object.fromEntries(state.definition.domains.map((d) => [d.id, typeof draft.notes?.[d.id] === 'string' ? draft.notes[d.id].slice(0, 600) : ''])),
      conversation: Object.fromEntries(state.definition.conversation.map((q) => [q.id, typeof draft.conversation?.[q.id] === 'string' ? draft.conversation[q.id].slice(0, q.type === 'date' ? 10 : 400) : ''])),
      step: Number.isInteger(draft.step) && draft.step >= 0 && draft.step <= 5 ? draft.step : 0,
      submissionId: typeof draft.submissionId === 'string' && /^[a-f0-9-]{36}$/i.test(draft.submissionId) ? draft.submissionId : crypto.randomUUID() };
  } catch { return null; }
}

async function loadWorkspace() {
  const [definition, saved] = await Promise.all([api('/scorecard/definition'), api('/scorecard/report')]);
  state.definition = definition;
  state.report = saved.report;
  state.mail = saved.mail;
  state.answers = saved.report ? [...saved.report.answers] : Array(20).fill(null);
  state.notes = saved.report ? { ...saved.report.notes } : {};
  state.conversation = saved.report ? { ...saved.report.conversation } : {};
  state.step = 0;
  state.submissionId = saved.report?.submissionId || crypto.randomUUID();
  const draft = readDraft();
  if (draft && draft.submissionId !== saved.report?.submissionId) Object.assign(state, draft);
  $('boot-status').hidden = true;
  $('workspace').hidden = false;
  $('view-saved').hidden = !state.report;
  message('workspace-message');
  if (state.report && (!draft || draft.submissionId === state.report.submissionId)) renderResults();
  else showAssessment(false);
}

function sectionCount(domain) { return domain.questions.filter((q) => state.answers[q.id - 1] !== null).length; }
function updateProgress() {
  const count = state.answers.filter((a) => a !== null).length;
  $('progress-label').textContent = `${count} of 20 answered`;
  $('assessment-progress').value = count;
  $('assessment-progress').textContent = `${count} of 20`;
  $('step-nav').innerHTML = state.definition.domains.map((d, i) => `<button type="button" class="step-tab" data-step="${i}" ${i === state.step ? 'aria-current="step"' : ''} aria-label="${h(d.title)}, ${sectionCount(d)} of 4 answered"><span>${d.letter}</span><span>${h(d.title)}</span><small>${sectionCount(d)}/4</small></button>`).join('') +
    `<button type="button" class="step-tab" data-step="5" ${state.step === 5 ? 'aria-current="step"' : ''} aria-label="Review your answers"><span>↗</span><span>Review answers</span></button>`;
}

function focusStep() {
  const header = $('step-title');
  header.focus({ preventScroll: true });
  header.scrollIntoView({ block: 'start', behavior: 'instant' });
}
function showAssessment(focus = true) {
  $('results-view').hidden = true;
  $('assessment-view').hidden = false;
  renderStep();
  if (focus) focusStep();
}

function renderStep() {
  message('step-error');
  updateProgress();
  $('previous-step').hidden = state.step === 0;
  $('step-count').textContent = `${state.step + 1} / 6`;
  $('next-step').innerHTML = state.step === 5 ? 'Get my score <span aria-hidden="true">↗</span>' : 'Continue <span aria-hidden="true">→</span>';
  if (state.step < 5) {
    const domain = state.definition.domains[state.step];
    $('step-content').innerHTML = `<header class="step-header"><p class="eyebrow">Area ${state.step + 1} of 5</p><h2 id="step-title" tabindex="-1">${h(domain.title)}</h2></header>` +
      domain.questions.map((q) => `<fieldset class="question" id="question-${q.id}"><legend><span class="question-number">${String(q.id).padStart(2, '0')}</span><span>${h(q.statement)}</span></legend><div class="answer-options">${state.definition.scale.map((a) => `<label class="answer-option"><input type="radio" name="question-${q.id}" data-question="${q.id}" value="${a.value}" ${state.answers[q.id - 1] === a.value ? 'checked' : ''} required><span class="answer-choice"><span class="answer-number">${a.value}</span><span class="answer-label">${h(a.label)}</span></span></label>`).join('')}</div></fieldset>`).join('') +
      `<details class="evidence-notes" ${state.notes[domain.id] ? 'open' : ''}><summary>Add supporting notes <span>(optional)</span></summary><p>Name a policy, process or record that supports your answers. Leave out confidential details.</p><label for="note-${domain.id}">Notes</label><textarea id="note-${domain.id}" data-note="${domain.id}" rows="3" maxlength="600">${h(state.notes[domain.id] || '')}</textarea></details>`;
  } else {
    const count = state.answers.filter((a) => a !== null).length;
    $('step-content').innerHTML = `<header class="step-header"><h2 id="step-title" tabindex="-1">Review your answers</h2><p>${count === 20 ? 'All 20 statements are answered.' : `${20 - count} ${count === 19 ? 'statement is' : 'statements are'} unanswered. Choose an area to finish.`}</p></header>` +
      state.definition.domains.map((d, i) => `<div class="review-row"><strong>${h(d.title)}</strong><span>${sectionCount(d)} / 4 answered</span><button class="text-button" type="button" data-step="${i}" aria-label="Review ${h(d.title)}">${sectionCount(d) === 4 ? 'Review' : 'Finish'}</button></div>`).join('') +
      `<details class="conversation-inputs" ${Object.values(state.conversation).some(Boolean) ? 'open' : ''}><summary>Team discussion notes (optional)</summary><p>Discuss a proposed use of AI with your team. Your notes will be included in the report.</p>${state.definition.conversation.map((q) => `<label for="conversation-${q.id}">${h(q.label)}</label>${q.type === 'date' ? `<input type="date" id="conversation-${q.id}" data-conversation="${q.id}" value="${h(state.conversation[q.id] || '')}">` : `<textarea rows="2" maxlength="400" id="conversation-${q.id}" data-conversation="${q.id}">${h(state.conversation[q.id] || '')}</textarea>`}`).join('')}</details>` +
      `<p class="submit-note">DMS can view your answers and notes. ${reportEmailLine()} <button id="change-report-email" class="text-button" type="button">Change this address</button></p>` +
      `<div id="email-change" class="email-change" hidden><label for="new-email">Email address for your report</label><div class="email-change__row"><input id="new-email" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" maxlength="254" value="${h(state.email)}"><button id="save-email" class="btn btn--outline" type="button">Use this address</button></div><p id="email-change-error" class="message message--error" role="alert" hidden></p></div>`;
  }
}

/* One address is emailed one report a day and five ever, so the page says
   which will happen before the visitor submits. */
function reportEmailLine() {
  const to = `<strong>${h(state.email)}</strong>`;
  if (state.mail.allowed) return `We’ll email your report to ${to}.`;
  return state.mail.reason === 'lifetime'
    ? `We’ve emailed five reports to ${to}, which is the most we send to one address, so this one won’t be emailed. You can download it on the next page.`
    : `We’ve already emailed a report to ${to} today, so this one won’t be emailed. You can download it on the next page.`;
}

function changeStep(index) {
  if (state.busy) return;
  state.step = index;
  renderStep();
  saveDraft();
  focusStep();
}
$('step-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-step]');
  if (button) changeStep(Number(button.dataset.step));
});
$('step-content').addEventListener('click', (event) => {
  const button = event.target.closest('[data-step]');
  if (button) changeStep(Number(button.dataset.step));
  else if (event.target.closest('#change-report-email')) {
    $('email-change').hidden = false;
    $('new-email').focus();
  } else if (event.target.closest('#save-email')) saveReportEmail();
});

/* Corrects the address the report goes to. The answers stay where they are. */
async function saveReportEmail() {
  if (state.busy) return;
  message('email-change-error');
  try {
    const { email } = await busyButton($('save-email'), 'Saving…', () => api('/access', { method: 'PATCH', body: { email: $('new-email').value } }));
    if (email !== state.email) {
      clearDraft(state.email);
      state.email = email;
      $('visit-email').textContent = email;
      state.mail = (await api('/scorecard/report')).mail;
      saveDraft();
    }
    renderStep();
    document.querySelector('.submit-note').scrollIntoView({ block: 'nearest' });
  } catch (err) {
    if (err.status === 401) goToEmailForm();
    else message('email-change-error', err.message, true);
  }
}
$('step-content').addEventListener('input', (event) => {
  const target = event.target;
  if (target.dataset.question) {
    state.answers[Number(target.dataset.question) - 1] = Number(target.value);
    target.closest('.question').removeAttribute('data-missing');
    updateProgress();
  } else if (target.dataset.note) state.notes[target.dataset.note] = target.value;
  else if (target.dataset.conversation) state.conversation[target.dataset.conversation] = target.value;
  else return;
  state.submissionId = crypto.randomUUID();
  saveDraft();
  message('step-error');
});
$('previous-step').addEventListener('click', () => changeStep(Math.max(0, state.step - 1)));
$('assessment-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const domains = state.step < 5 ? [state.definition.domains[state.step]] : state.definition.domains;
  const missing = domains.flatMap((d) => d.questions).filter((q) => state.answers[q.id - 1] === null);
  if (missing.length) {
    if (state.step === 5) {
      state.step = state.definition.domains.findIndex((d) => d.questions.some((q) => q.id === missing[0].id));
      renderStep();
    }
    message('step-error', 'Answer the highlighted statements to continue.', true);
    missing.forEach((q) => $(`question-${q.id}`)?.setAttribute('data-missing', 'true'));
    document.querySelector(`#question-${missing[0].id} input`)?.focus();
    return;
  }
  if (state.step < 5) return changeStep(state.step + 1);
  state.busy = true;
  $('assessment-form').setAttribute('aria-busy', 'true');
  $('step-content').inert = true;
  try {
    await busyButton($('next-step'), 'Saving your report…', async () => {
      const { report, mail } = await api('/scorecard/report', { method: 'POST', body: { answers: state.answers, notes: state.notes,
        conversation: state.conversation, submissionId: state.submissionId } });
      state.report = report;
      state.mail = mail;
      clearDraft(state.email);
      $('view-saved').hidden = false;
      renderResults();
      $('results-title').focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  } catch (err) { handleError(err, 'step-error'); }
  finally { state.busy = false; $('step-content').inert = false; $('assessment-form').removeAttribute('aria-busy'); }
});

function renderResults() {
  const report = state.report;
  $('assessment-view').hidden = true;
  $('results-view').hidden = false;
  message('workspace-message');
  $('report-date').textContent = `Completed ${longDate(report.createdAt)}`;
  $('score-summary').innerHTML = summaryHtml(report, state.definition);
  $('report-detail').innerHTML = detailHtml(report, state.definition);
  fillMeters($('report-detail'));
  renderDelivery();
}

function renderDelivery() {
  const delivery = state.report.delivery || {};
  const to = delivery.to || state.email;
  const status = delivery.status;
  $('email-status').textContent = status === 'sent' ? `Report sent to ${to}. Check your spam folder if it hasn’t arrived.`
    : status === 'development' ? 'Your report is saved. Email is turned off on this site; you can download your report.'
    : status === 'limited' && delivery.reason === 'lifetime' ? `Your report is saved. We’ve emailed five reports to ${to}, which is the most we send to one address, so this one wasn’t sent. You can download it.`
    : status === 'limited' ? `Your report is saved. We’ve already emailed a report to ${to} today, so this one wasn’t sent. You can download it.`
    : status === 'pending' ? 'Your report is saved. We couldn’t confirm whether the email was sent. You can download your report or try emailing it again in a minute.'
    : 'Your report is saved. We couldn’t email it, so you can download it or try emailing it again in a minute.';
  // Offered only while another report can go to this address.
  $('email-report').hidden = !state.mail.allowed;
  $('email-report').textContent = status === 'sent' ? 'Email my report again' : 'Try emailing my report';
}
$('email-report').addEventListener('click', async (event) => {
  message('workspace-message');
  try {
    await busyButton(event.currentTarget, 'Sending…', async () => {
      const { report, mail } = await api('/scorecard/report/email', { method: 'POST' });
      state.report = report;
      state.mail = mail;
    });
    renderDelivery();
  } catch (err) {
    if (err.status === 401) handleError(err);
    else $('email-status').textContent = err.message;
  }
});
$('edit-answers').addEventListener('click', () => { saveDraft(); showAssessment(); });
$('view-saved').addEventListener('click', () => { renderResults(); $('results-title').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); });
$('print-report').addEventListener('click', () => window.print());
printWithAnswersOpen();

try {
  const visit = await loadVisit();
  state.email = visit.email;
  await loadWorkspace();
} catch (err) {
  $('boot-status').textContent = err.message;
}
