// Shared by every page behind the email form.

export const $ = (id) => document.getElementById(id);

export const h = (value) => String(value ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) }) });
  } catch { throw new Error('We could not connect. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: response.status, code: data.code });
  return data;
}

export function message(id, text = '', error = false) {
  const el = $(id);
  el.textContent = text;
  el.hidden = !text;
  el.classList.toggle('message--error', error);
}

export async function busyButton(button, label, task) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  try { return await task(); }
  finally { button.innerHTML = original; button.disabled = false; }
}

export const longDate = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

// The scorecard draft is kept in this browser until it is submitted or the visitor switches address.
export const draftKey = (email) => `dms-resources:scorecard-draft:v1:${email}`;
export function clearDraft(email) {
  try { localStorage.removeItem(draftKey(email)); } catch { /* Nothing was stored. */ }
}

/* What a visitor types into the four fill-in pages. It is kept in this browser
   and never sent to the server. */
export const SHEETS = ['incident-plan', 'ai-rules', 'ai-brief', 'vendor-questions'];
export const sheetKey = (name, email) => `dms-resources:${name}:v1:${email}`;
export function clearSheets(email) {
  for (const name of SHEETS) {
    try { localStorage.removeItem(sheetKey(name, email)); } catch { /* Nothing was stored. */ }
  }
}

// What the email form reports about the links email, read once by the next page.
const ARRIVAL = 'dms-resources:arrival';
export function rememberArrival(result) {
  try { sessionStorage.setItem(ARRIVAL, JSON.stringify(result)); } catch { /* The note is optional. */ }
}
function showArrivalNote() {
  const note = $('arrival-note');
  if (!note) return;
  let arrival = null;
  try {
    arrival = JSON.parse(sessionStorage.getItem(ARRIVAL));
    sessionStorage.removeItem(ARRIVAL);
  } catch { /* No note. */ }
  if (arrival?.emailed === 'sent') message('arrival-note', `We emailed the links to ${arrival.email}, so you can come back on any device.`);
  else if (arrival?.emailed === 'failed') message('arrival-note', `We couldn’t email the links to ${arrival.email}. Bookmark this page to come back to it.`);
}

// This browser has no address on file: go to the email form and come back here afterwards.
export function goToEmailForm() {
  window.location.replace(`/?next=${encodeURIComponent(window.location.pathname)}`);
}

/* Shows which address this browser is using and wires "Use a different email".
   Returns { email, staff }, or goes to the email form when there is no address. */
export async function loadVisit() {
  let visit;
  try { visit = await api('/access'); }
  catch (err) {
    if (err.status === 401) { goToEmailForm(); return new Promise(() => {}); }
    throw err;
  }
  $('visit-email').textContent = visit.email;
  const staffLink = $('staff-link');
  if (staffLink) staffLink.hidden = !visit.staff;
  $('use-different-email').addEventListener('click', async (event) => {
    try {
      await busyButton(event.currentTarget, 'One moment…', () => api('/access', { method: 'DELETE' }));
      clearDraft($('visit-email').textContent);
      clearSheets($('visit-email').textContent);
      window.location.replace('/');
    } catch (err) { window.alert(err.message); }
  });
  showArrivalNote();
  return visit;
}
