import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { DOMAINS, SCALE, BANDS, CONVERSATION, validateAssessment, scoreAssessment } from '../src/scorecard-content.js';

const payload = (answers = Array(20).fill(2)) => ({ answers, submissionId: crypto.randomUUID(), notes: {}, conversation: {} });

/* The statements, scale, bands and discussion prompts are Javed Sajad's source
   text. This fails on any edit to them, including a "tone" rewrite, so a
   change has to be deliberate: check it against the toolkit, then update the
   hash. */
test('the source statements, scale, bands and prompts are unchanged', () => {
  const source = JSON.stringify({
    statements: DOMAINS.map((d) => [d.letter, d.title, d.questions.map((q) => [q.id, q.statement])]),
    scale: SCALE.map((s) => [s.value, s.label]),
    bands: BANDS,
    prompts: CONVERSATION.map((q) => q.label),
  });
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'),
    '95d17330267c1b27d548c3e98ad5a872d37134c64956d1bd39b3887baa3bf86c');
});

test('all 41 totals use the source bands and five scores out of 8', () => {
  for (let total = 0; total <= 40; total++) {
    const answers = Array.from({ length: 20 }, (_, i) => Math.min(2, Math.max(0, total - i * 2)));
    const result = scoreAssessment(answers);
    assert.equal(result.total, total);
    assert.equal(result.band.name, total <= 10 ? 'Unmapped' : total <= 20 ? 'Experimental' : total <= 30 ? 'Controlled' : 'Governed');
    assert.equal(result.domains.length, 5);
    assert.equal(result.domains.reduce((n, d) => n + d.score, 0), total);
    assert.ok(result.domains.every((d) => d.score >= 0 && d.score <= 8));
  }
  assert.equal(DOMAINS.flatMap((d) => d.questions).length, 20);
});

test('a high total still reports a critical vendor or human-review gap', () => {
  const answers = Array(20).fill(2);
  answers[9] = 0;
  answers[13] = 0;
  const result = scoreAssessment(answers);
  assert.equal(result.total, 36);
  assert.equal(result.band.name, 'Governed');
  assert.deepEqual(result.criticalGaps.map((g) => g.id), [10, 14]);
  assert.deepEqual(result.priorities.map((g) => g.id), [10, 14]);
  assert.equal(scoreAssessment(Array(20).fill(2)).criticalGaps.length, 0);
});

test('a partial answer is not a gap, and next steps put zero answers to critical statements first', () => {
  const answers = Array(20).fill(2);
  answers[0] = 1;   // statement 1, not critical
  answers[9] = 1;   // statement 10, critical but partial
  answers[16] = 0;  // statement 17, critical
  const result = scoreAssessment(answers);
  assert.deepEqual(result.criticalGaps.map((g) => g.id), [17]);
  assert.deepEqual(result.priorities.map((p) => p.id), [17, 1, 10]);
});

test('missing, coerced, out-of-range and oversized answers are rejected', () => {
  for (const answers of [[], Array(19).fill(2), Array(21).fill(0), Array(20).fill(null), Array(20).fill('2'), Array(20).fill(3), Array(20).fill(-1), Array(20).fill(true)]) {
    assert.throws(() => validateAssessment(payload(answers)), { status: 400 });
  }
  assert.throws(() => validateAssessment({ ...payload(), notes: { data: 'x'.repeat(601) } }), { status: 400 });
  assert.throws(() => validateAssessment({ ...payload(), conversation: { date: '2026-02-30' } }), { status: 400 });
  assert.throws(() => validateAssessment({ ...payload(), submissionId: 'unsafe' }), { status: 400 });
  assert.deepEqual(validateAssessment({ ...payload(), notes: { data: '  kept  ', unknown: 'dropped' } }).notes,
    { visibility: '', purpose: '', data: 'kept', human: '', implementation: '' });
});
