import { $, h, api, message, loadVisit, longDate } from './common.js';
import { summaryHtml, detailHtml, fillMeters } from './report-view.js';

let visitors = [];

const when = (iso) => new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function scorecardCell(visitor) {
  const card = visitor.scorecard;
  if (card.status === 'completed') {
    return `<strong>${card.score} / ${card.max}</strong> ${h(card.level)}<br><a href="/ops?scorecard=${encodeURIComponent(visitor.email)}" data-report="${h(visitor.email)}">View report</a>`;
  }
  return card.status === 'unavailable' ? 'Could not be read' : 'Not completed';
}

function renderList() {
  const text = $('filter').value.trim().toLowerCase();
  const status = $('score-filter').value;
  const shown = visitors.filter((v) => (!text || v.email.includes(text) || v.events.some((e) => e.includes(text))) &&
    (status === 'all' || v.scorecard.status === status));
  $('rows').innerHTML = shown.map((v) => `<tr><td class="email">${h(v.email)}</td><td>${h(v.events.join(', ')) || '<span class="none">None</span>'}</td>` +
    `<td>${h(when(v.firstSeenAt))}</td><td>${h(when(v.lastSeenAt))}</td><td>${scorecardCell(v)}</td></tr>`).join('');
  $('empty').textContent = visitors.length ? 'No visitors match these filters.' : 'Nobody has entered an email address yet.';
  $('empty').hidden = shown.length > 0;
}

async function loadList() {
  message('list-message');
  try {
    const data = await api('/ops/visitors');
    visitors = data.visitors;
    $('total-visitors').textContent = data.count;
    $('total-completed').textContent = data.completed;
    $('total-mail').textContent = data.mail.limit ? `${data.mail.sent} of ${data.mail.limit}` : data.mail.sent;
    $('total-refused').textContent = data.refused;
    renderList();
  } catch (err) {
    if (err.status === 401) window.location.replace('/ops');
    else message('list-message', err.message, true);
  }
}

async function showReport(email) {
  $('list-view').hidden = true;
  $('report-view').hidden = false;
  $('report-body').hidden = true;
  $('report-export').hidden = true;
  $('report-date').textContent = email;
  message('report-message', 'Loading the report…');
  try {
    const { report, definition } = await api(`/ops/scorecard?email=${encodeURIComponent(email)}`);
    $('report-date').textContent = `${report.email} · completed ${longDate(report.createdAt)}`;
    $('score-summary').innerHTML = summaryHtml(report, definition);
    $('report-detail').innerHTML = detailHtml(report, definition);
    fillMeters($('report-detail'));
    $('report-detail').querySelectorAll('details').forEach((d) => { d.open = true; });
    $('report-export').href = `/api/ops/scorecard/export?email=${encodeURIComponent(email)}&format=csv`;
    $('report-export').hidden = false;
    $('report-body').hidden = false;
    message('report-message');
  } catch (err) {
    if (err.status === 401) window.location.replace('/ops');
    else message('report-message', err.message, true);
  }
  $('report-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function showList() {
  $('report-view').hidden = true;
  $('list-view').hidden = false;
}

// The address bar carries which report is open, so Back and a shared link both work.
function route() {
  const email = new URLSearchParams(window.location.search).get('scorecard');
  if (email) showReport(email);
  else showList();
}

$('rows').addEventListener('click', (event) => {
  const link = event.target.closest('[data-report]');
  if (!link) return;
  event.preventDefault();
  window.history.pushState({}, '', link.getAttribute('href'));
  route();
});
$('back-to-list').addEventListener('click', (event) => {
  event.preventDefault();
  window.history.pushState({}, '', '/ops');
  route();
});
window.addEventListener('popstate', route);
$('filter').addEventListener('input', renderList);
$('score-filter').addEventListener('change', renderList);
$('refresh').addEventListener('click', loadList);

await loadVisit();
await loadList();
route();
