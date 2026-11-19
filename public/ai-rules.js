import { $ } from './common.js';
import { openSheet, show } from './sheet.js';

const MAX_TOOLS = 8; // more would push the handout onto a second page
const rows = $('tool-rows');

function addRow() {
  const row = rows.firstElementChild.cloneNode(true);
  const number = rows.children.length + 1;
  for (const input of row.querySelectorAll('input')) {
    input.value = '';
    input.setAttribute('aria-label', input.getAttribute('aria-label').replace(/\d+/, number));
  }
  rows.append(row);
  $('add-tool').hidden = rows.children.length >= MAX_TOOLS;
  return row;
}

// An element holding one value, shown as a line to write on when the value is empty.
function line(tag, value, label) {
  const el = document.createElement(tag);
  show(el, value);
  if (!value && label) el.dataset.label = label;
  return el;
}

function draw(values) {
  // Approved tools: the rows that have something in them, or three lines to write on.
  const tools = (values.tool || []).map((tool, i) => [tool, values.use[i]]).filter(([tool, use]) => tool || use);
  $('tool-list').replaceChildren(...(tools.length ? tools : Array(3).fill(['', ''])).map(([tool, use], i) => {
    const row = document.createElement('tr');
    row.append(line('td', tool, !tools.length && i === 0 ? 'the approved tools' : ''), line('td', use));
    return row;
  }));

  // What stays out: the ticked lines, in the words on the form, then anything added.
  const never = [...document.querySelectorAll('input[name="never"]:checked')].map((box) => box.closest('label').textContent.trim());
  if (values.other) never.push(values.other);
  $('never-list').replaceChildren(...(never.length ? never : ['']).map((item) => line('li', item, 'the information that stays out of AI tools')));

  // One person often does both jobs, so a blank second pair repeats the first,
  // and a line still blank there is named once, as the first pair's.
  const own = Boolean(values.reporter);
  const reporter = $('show-reporter');
  const contact = $('show-reporter-contact');
  show(reporter, own ? values.reporter : values.approver);
  show(contact, own ? values.reporterContact : values.approverContact);
  reporter.dataset.label = own ? 'who to tell about a problem' : 'who approves a new AI tool';
  contact.dataset.label = own ? 'how to reach the person to tell about a problem' : 'how to reach the person who approves a new tool';
}

const sheet = await openSheet('ai-rules', {
  // Saved tools beyond the three rows on the page need rows of their own before the form is filled.
  before(saved) {
    const count = Math.min(MAX_TOOLS, Math.max(saved.tool?.length || 0, saved.use?.length || 0));
    while (rows.children.length < count) addRow();
  },
  draw,
});

$('add-tool').addEventListener('click', () => {
  addRow().querySelector('input').focus();
  sheet.save();
});
