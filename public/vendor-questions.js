/* AI vendor questions. The questions are written once, in the page, as plain
   list items. This script adds the answer box and the "your view" choice under
   each one, and lists the same questions in the record beside the form. */

import { $, message } from './common.js';
import { openSheet, listed } from './sheet.js';

const form = $('sheet-form');
const view = $('view').content.querySelector('select');
const flagged = [...view.options].filter((option) => option.dataset.flag !== undefined).map((option) => option.value);
const groups = [];      // { title, questions }
const questions = [];   // { id, number, text, item }

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function build() {
  for (const fieldset of form.querySelectorAll('fieldset[data-group]')) {
    const group = { title: fieldset.querySelector('legend').textContent.trim(), questions: [] };
    const section = element('section', 'sheet__group');
    const list = element('ol', 'sheet__qs');
    list.start = questions.length + 1;

    for (const item of fieldset.querySelectorAll('li[data-q]')) {
      const question = { id: item.dataset.q, number: questions.length + 1, text: item.textContent.trim(), item };
      questions.push(question);
      group.questions.push(question);

      const label = element('label');
      label.htmlFor = `a-${question.id}`;
      label.append(element('span', 'q__n', question.number), ` ${question.text}`);
      const answer = element('textarea');
      Object.assign(answer, { id: `a-${question.id}`, name: `a-${question.id}`, rows: 2, maxLength: 280 });
      const mark = view.cloneNode(true);
      mark.name = `s-${question.id}`;
      mark.setAttribute('aria-label', `Your view of the answer to question ${question.number}`);
      item.replaceChildren(label, answer, mark);

      const shown = element('p', 'sheet__a');
      shown.dataset.show = answer.name;
      const marked = element('p', 'choice');
      marked.dataset.choice = mark.name;
      const row = element('div', 'sheet__row');
      row.append(element('p', 'sheet__q', question.text), shown, marked);
      list.append(element('li'));
      list.lastElementChild.append(row);
    }
    section.append(element('h3', '', group.title), list);
    $('answers').append(section);
    groups.push(group);
  }
}

const count = (values, name) => questions.filter((question) => values[`s-${question.id}`] === name);

function draw(values) {
  for (const question of questions) question.item.classList.toggle('is-open', flagged.includes(values[`s-${question.id}`]));
  // Under the decision: the questions still open, by number.
  const open = flagged.map((name) => [name, count(values, name)]).filter(([, found]) => found.length)
    .map(([name, found]) => `${name}: ${found.length === 1 ? 'question' : 'questions'} ${listed.format(found.map((question) => String(question.number)))}.`);
  $('open-items').textContent = open.join(' ');
  $('open-items').hidden = !open.length;
}

function status(values) {
  const marked = questions.filter((question) => values[`s-${question.id}`]).length;
  const open = flagged.map((name) => [name, count(values, name).length]).filter(([, found]) => found)
    .map(([name, found]) => `${name}: ${found}.`);
  return [`${marked} of ${questions.length} questions marked.`, ...open].join(' ');
}

build();
await openSheet('vendor-questions', { draw, status });

// The questions alone, to paste into an email to the vendor.
const copy = $('copy-questions');
if (!navigator.clipboard) copy.hidden = true;
copy.addEventListener('click', async () => {
  const text = [$('questions-note').content.textContent.trim(), '',
    ...groups.flatMap((group) => [group.title, ...group.questions.map((question) => `${question.number}. ${question.text}`), ''])].join('\n').trim();
  try {
    await navigator.clipboard.writeText(text);
    message('questions-message', 'Copied. Paste the questions into an email to the vendor.');
  } catch { message('questions-message', 'We couldn’t copy the questions. Select them on the page and copy them instead.', true); }
});
