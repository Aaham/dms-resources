/* The fill-in pages (incident plan, AI rules for staff, board and executive AI
   brief, AI vendor questions): a form, and the page it produces. What the
   visitor types is kept in this browser's localStorage and is never sent to
   the server.

   The form and the page are tied by name: a control named "lead" fills every
   element in the page marked data-show="lead". A line with nothing typed for
   it shows as a rule to write on, so a half-filled page can still be printed.

   A choice (radio buttons or a select) named "decision" fills every element
   marked data-choice="decision": the option chosen, or every option with an
   empty box when none is, so the choice can be ticked on paper. */

import { $, loadVisit, longDate, message, sheetKey } from './common.js';

export const BLANK = '_______________';

const named = (form) => [...form.elements].filter((el) => el.name);
// Controls marked data-row repeat (the approved tools), so their values are kept as a list.
const isRow = (el) => el.dataset.row !== undefined;

function collect(form) {
  const values = {};
  for (const el of named(form)) {
    if (el.type === 'checkbox') {
      values[el.name] ||= [];
      if (el.checked) values[el.name].push(el.value);
    } else if (el.type === 'radio') {
      values[el.name] ||= '';
      if (el.checked) values[el.name] = el.value;
    } else if (isRow(el)) (values[el.name] ||= []).push(el.value.trim());
    else values[el.name] = el.value.trim();
  }
  return values;
}

function fill(form, saved) {
  const index = {};
  for (const el of named(form)) {
    if (!(el.name in saved)) continue;
    const value = saved[el.name];
    if (el.type === 'checkbox') el.checked = Array.isArray(value) && value.includes(el.value);
    else if (el.type === 'radio') el.checked = value === el.value;
    else if (isRow(el)) {
      index[el.name] = (index[el.name] ?? -1) + 1;
      el.value = (Array.isArray(value) && value[index[el.name]]) || '';
    } else el.value = typeof value === 'string' ? value : '';
  }
}

export function show(el, value) {
  el.textContent = value || BLANK;
  el.classList.toggle('is-blank', !value);
}

// The options of a choice: the values of its radio buttons, or of its select's options.
function optionsOf(form, name) {
  const control = form.elements[name];
  if (!control) return [];
  const options = control.options ? [...control.options] : [...control];
  return options.map((option) => option.value).filter(Boolean);
}

export function showChoice(el, value, options) {
  el.replaceChildren(...(value ? [value] : options).map((option) => {
    const tick = document.createElement('span');
    tick.className = value ? 'tick is-on' : 'tick';
    tick.textContent = option;
    return tick;
  }));
  el.classList.toggle('is-marked', Boolean(value));
  // What "Copy as text" writes in place of the boxes.
  el.dataset.text = value ? `[x] ${value}` : options.map((option) => `[ ] ${option}`).join('  ');
}

// "a, b and c", as the pages are written: no comma before "and".
export const listed = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

function blankStatus(sheet) {
  const blank = [...new Set([...sheet.querySelectorAll('.is-blank[data-label]')].map((el) => el.dataset.label))];
  if (!blank.length) return 'Every line is filled in.';
  if (blank.length > 3) return `${blank.length} lines are still blank. They print as lines you can write on.`;
  return `Still blank: ${listed.format(blank)}. ${blank.length === 1 ? 'It prints as a line' : 'They print as lines'} you can write on.`;
}

/* The page as plain text, for pasting into a document or an email. */
function inline(el) {
  if (el.dataset.text !== undefined) return el.dataset.text;
  let source = el;
  if (el.querySelector('[data-text]')) {
    source = el.cloneNode(true);
    for (const part of source.querySelectorAll('[data-text]')) part.textContent = part.dataset.text;
  }
  return source.textContent.replace(/\s+/g, ' ').trim();
}
function lines(el, top = false) {
  const out = [];
  for (const child of el.children) {
    if (child.hidden) continue;
    if (child.matches('ol, ul')) {
      [...child.children].forEach((item, number) => {
        // A list that continues an earlier one says where it starts.
        const mark = child.matches('ol') ? `${child.start + number}. ` : '- ';
        const inner = item.querySelector('h3, p') ? lines(item) : [inline(item)];
        inner.filter(Boolean).forEach((line, i) => out.push((i ? ' '.repeat(mark.length) : mark) + line));
      });
      if (top) out.push('');
    } else if (child.matches('table')) {
      for (const row of child.rows) out.push([...row.cells].map(inline).join(' | '));
    } else if (child.matches('dl')) {
      for (const row of child.children) out.push(`${inline(row.querySelector('dt'))}: ${inline(row.querySelector('dd'))}`);
    } else if (child.matches('h2, h3, p')) out.push(inline(child));
    else out.push(...lines(child), '');
  }
  return out;
}
export const sheetText = (sheet) => lines(sheet, true).join('\n').replace(/\n{3,}/g, '\n\n').trim();

/* Opens a fill-in page. `before(saved)` runs before the form is filled, so a
   page can add rows for what was saved; `draw(values)` fills the parts of the
   page that are not a plain data-show line or a data-choice; `status(values)`
   replaces the line that says which lines are still blank. */
export async function openSheet(name, { before = () => {}, draw = () => {}, status = null } = {}) {
  const { email } = await loadVisit();
  const key = sheetKey(name, email);
  const form = $('sheet-form');
  const sheet = $('sheet');

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* Start empty. */ }
  before(saved);
  fill(form, saved);

  function render() {
    const values = collect(form);
    for (const el of sheet.querySelectorAll('[data-show]')) show(el, values[el.dataset.show]);
    for (const el of sheet.querySelectorAll('[data-choice]')) showChoice(el, values[el.dataset.choice], optionsOf(form, el.dataset.choice));
    draw(values);
    for (const el of sheet.querySelectorAll('[data-today]')) el.textContent = longDate(new Date());
    $('sheet-status').textContent = status ? status(values) : blankStatus(sheet);
    return values;
  }
  function save() {
    const values = render();
    message('sheet-message');
    try { localStorage.setItem(key, JSON.stringify(values)); } catch { /* Storage is off: the page works until it is closed. */ }
  }

  form.addEventListener('input', save);
  form.addEventListener('change', save);
  form.addEventListener('submit', (event) => event.preventDefault());

  $('print-sheet').addEventListener('click', () => window.print());

  const copy = $('copy-sheet');
  if (!navigator.clipboard) copy.hidden = true;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(sheetText(sheet));
      message('sheet-message', 'Copied. Paste it into a document or an email.');
    } catch { message('sheet-message', 'We couldn’t copy the page. Select its text and copy it instead.', true); }
  });

  const asking = (on) => { $('clear-sheet').hidden = on; $('clear-confirm').hidden = !on; };
  $('clear-sheet').addEventListener('click', () => { asking(true); $('clear-no').focus(); });
  $('clear-no').addEventListener('click', () => { asking(false); $('clear-sheet').focus(); });
  $('clear-yes').addEventListener('click', () => {
    try { localStorage.removeItem(key); } catch { /* Nothing was stored. */ }
    form.reset();
    render();
    asking(false);
    message('sheet-message', 'The form is empty.');
  });

  render();
  return { form, sheet, save };
}
