import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { initialState, transition, restoreState, progress, statusFor, makeReview, canSubmit, formatSubmission, isStale } from '../src/core.js';

const fixture = JSON.parse(readFileSync(new URL('../data/questions.json', import.meta.url)));
const initial = () => initialState(fixture);
const edit = (state, id, optionIds, text = '') => transition(state, { type: 'edit', questionId: id, answer: { optionIds, text } });
const review = (state, id = 'submission-1') => makeReview(state, id, '2026-09-05T12:00:00.000Z');

test('recommendations do not select or submit an answer', () => {
  assert.deepEqual(initial().drafts, {});
  assert.deepEqual(progress(initial()), { total: 3, answered: 0, submitted: 0, draft: 0, unanswered: 3, deferred: 0, pending: 3 });
});

test('whole-form submission includes blanks, rejects subsets, and preserves immutable retries', () => {
  let state = edit(initial(), 'atmosphere', ['quiet'], 'First answer');
  state = edit(state, 'activities', ['open-reading'], 'PRIVATE PENDING DRAFT');
  const beforeB = structuredClone(state.drafts.activities);
  const snapshot = review(state);
  state = transition(state, { type: 'submit', review: snapshot });
  assert.deepEqual(state.drafts.activities, beforeB);
  assert.equal(progress(state).pending, 0);
  assert.deepEqual(snapshot.answers.map(a => a.outcome), ['answered', 'answered', 'not_answered']);
  assert.match(formatSubmission(snapshot), /PRIVATE PENDING DRAFT/);
  assert.match(formatSubmission(snapshot), /Not answered: the user submitted/);
  assert.throws(() => transition(initial(), { type: 'submit', review: { ...snapshot, id: 'partial', answers: snapshot.answers.slice(0, 1) } }), /changed/);
  state = edit(state, 'atmosphere', ['social']);
  state = transition(state, { type: 'submit', review: snapshot });
  assert.equal(state.submissions.length, 1);
  assert.deepEqual(state.submissions[0], snapshot);
  assert.equal(statusFor(state, 'atmosphere'), 'draft');
});

test('stale review is rejected after editing, even when wording returns to the same value', () => {
  let state = edit(initial(), 'atmosphere', ['quiet']);
  const snapshot = review(state);
  state = edit(state, 'atmosphere', ['social']);
  state = edit(state, 'atmosphere', ['quiet']);
  assert.throws(() => transition(state, { type: 'submit', review: snapshot }), /changed/);
  assert.equal(state.submissions.length, 0);
});

test('definition updates retain drafts, detect wording changes without revision bumps, and preserve removed options', () => {
  let state = edit(initial(), 'atmosphere', ['quiet'], 'Keep my note');
  const original = structuredClone(state.drafts.atmosphere);
  const doc = structuredClone(state.questionnaire);
  doc.questions[0].title += ' Updated wording';
  state = transition(state, { type: 'definitions', questionnaire: doc });
  assert.deepEqual(state.drafts.atmosphere, original);
  assert.equal(canSubmit(state, 'atmosphere'), false);
  assert.equal(isStale(state, 'atmosphere'), true);
  state = transition(state, { type: 'adopt', questionId: 'atmosphere' });
  assert.equal(canSubmit(state, 'atmosphere'), true);
  assert.equal(state.drafts.atmosphere.previous[0].answer.text, 'Keep my note');
  doc.questions[0].options = doc.questions[0].options.filter(o => o.id !== 'quiet');
  state = transition(state, { type: 'definitions', questionnaire: doc });
  assert.throws(() => transition(state, { type: 'adopt', questionId: 'atmosphere' }), /no longer exists/);
  state = edit(state, 'atmosphere', ['social'], 'Keep my note');
  assert.equal(state.drafts.atmosphere.previous.at(-1).answer.optionIds[0], 'quiet');
  assert.equal(canSubmit(state, 'atmosphere'), true);
});

test('invalid persisted state is rejected without replacing it', () => {
  const raw = { ...initial(), schemaVersion: 999 };
  const before = JSON.stringify(raw);
  assert.throws(() => restoreState(raw));
  assert.equal(JSON.stringify(raw), before);
  assert.throws(() => initialState({ ...fixture, questions: [fixture.questions[0], fixture.questions[0]] }), /unique/);
});

test('changing a navigation label preserves drafts and the exact reviewed question', () => {
  let state = edit(initial(), 'atmosphere', ['social']);
  const snapshot = review(state);
  const before = structuredClone(state.drafts);
  const doc = structuredClone(state.questionnaire);
  doc.navigationLabels = { ...doc.navigationLabels, atmosphere: 'Room atmosphere' };
  state = transition(state, { type: 'definitions', questionnaire: doc });
  assert.deepEqual(state.drafts, before);
  assert.equal(isStale(state, 'atmosphere'), false);
  assert.equal(transition(state, { type: 'submit', review: snapshot }).submissions.length, 1);
});

test('generated answer histories agree with an independent small model after every action', () => {
  const actions = fc.array(fc.record({
    kind: fc.constantFrom('edit', 'defer', 'submit', 'reload', 'update', 'adopt', 'navigate'),
    index: fc.integer({ min: 0, max: 2 }), choice: fc.integer({ min: 0, max: 3 }),
    text: fc.string({ maxLength: 40 }), deferred: fc.boolean(),
  }), { minLength: 1, maxLength: 100 });
  fc.assert(fc.property(actions, commands => {
    let state = initial();
    const ids = ['atmosphere', 'activities', 'success'];
    const model = ids.map(() => ({ choice: [], text: '', deferred: false, answeredVersion: 1, version: 1, history: [] }));
    let submissionCount = 0;
    for (const [step, command] of commands.entries()) {
      const index = command.index, id = ids[index], item = model[index];
      const before = JSON.stringify(state), oldState = state, oldHistory = JSON.stringify(state.submissions);
      const otherDrafts = ids.filter(qid => qid !== id).map(qid => structuredClone(state.drafts[qid]));

      if (command.kind === 'edit') {
        const options = state.questionnaire.questions[index].options;
        item.choice = options.length && command.choice < options.length ? [options[command.choice].id] : [];
        item.text = command.text;
        item.answeredVersion = item.version;
        state = edit(state, id, item.choice, item.text);
      } else if (command.kind === 'defer') {
        item.deferred = command.deferred;
        state = transition(state, { type: 'defer', questionId: id, deferred: item.deferred });
      } else if (command.kind === 'update') {
        item.version++;
        const doc = structuredClone(state.questionnaire);
        doc.questions[index].revision = item.version;
        doc.questions[index].context = `Version ${item.version}`;
        state = transition(state, { type: 'definitions', questionnaire: doc });
      } else if (command.kind === 'adopt') {
        item.answeredVersion = item.version;
        state = transition(state, { type: 'adopt', questionId: id });
      } else if (command.kind === 'submit') {
        if (model.every(m => !(m.choice.length || m.text.trim()) || m.answeredVersion === m.version)) {
          const snapshot = review(state, `submission-${step}`);
          assert.equal(snapshot.answers.length, ids.length);
          state = transition(state, { type: 'submit', review: snapshot });
          state = transition(state, { type: 'submit', review: snapshot });
          for (const m of model) {
            m.deferred = false;
            m.answeredVersion = m.version;
            m.history.push(JSON.stringify({ choice: m.choice, text: m.text, version: m.answeredVersion }));
          }
          submissionCount++;
        } else assert.throws(() => review(state, `submission-${step}`));
      } else if (command.kind === 'reload') state = restoreState(JSON.parse(JSON.stringify(state)));
      assert.equal(JSON.stringify(oldState), before, 'transitions must not mutate input');
      if (command.kind !== 'submit') assert.deepEqual(ids.filter(qid => qid !== id).map(qid => state.drafts[qid]), otherDrafts, 'unrelated drafts');
      assert.equal(JSON.stringify(state.submissions.slice(0, JSON.parse(oldHistory).length)), oldHistory, 'immutable history');
      assert.equal(state.submissions.length, submissionCount, 'only explicit confirmations create submissions');
      assert.deepEqual(restoreState(JSON.parse(JSON.stringify(state))), state);
      let expectedSubmitted = 0;
      for (const [i, m] of model.entries()) {
        const has = Boolean(m.choice.length || m.text.trim());
        const isSubmitted = !m.deferred && m.answeredVersion === m.version && m.history.includes(JSON.stringify({ choice: m.choice, text: m.text, version: m.answeredVersion }));
        assert.equal(statusFor(state, ids[i]), isSubmitted ? 'submitted' : has ? 'draft' : 'unanswered');
        assert.deepEqual(state.drafts[ids[i]]?.optionIds || [], m.choice);
        assert.equal(state.drafts[ids[i]]?.text || '', m.text);
        assert.equal(state.drafts[ids[i]]?.deferred || false, m.deferred);
        if (isSubmitted) expectedSubmitted++;
      }
      assert.equal(progress(state).answered, model.filter(m => m.choice.length || m.text.trim()).length);
      assert.equal(progress(state).submitted, expectedSubmitted);
      assert.equal(progress(state).pending, 3 - expectedSubmitted);
    }
  }), { numRuns: 1000, seed: Number(process.env.FC_SEED || 20260905), ...(process.env.FC_PATH ? { path: process.env.FC_PATH } : {}) });
});
