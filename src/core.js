// Pure domain logic shared by the local server, browser, and generated tests.
const copy = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const insist = (condition, message) => { if (!condition) throw new Error(message); };
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const string = (value, max = 20000) => typeof value === 'string' && value.length <= max;

function validateQuestion(q) {
  insist(q && validId(q.id) && Number.isSafeInteger(q.revision) && q.revision > 0, 'Questions need a stable ID and positive revision.');
  insist(string(q.title) && q.title.trim() && string(q.context), 'Question wording is invalid.');
  insist(['single', 'multiple', 'text'].includes(q.type), 'Unsupported answer type.');
  insist(Array.isArray(q.options) && q.options.length <= 100, 'Options must be a list.');
  insist(q.type === 'text' ? q.options.length === 0 : q.options.length > 0, 'Question options do not match the answer type.');
  const seen = new Set();
  const options = q.options.map(o => {
    insist(o && validId(o.id) && !seen.has(o.id), 'Option IDs must be unique within a question.');
    seen.add(o.id);
    insist(['label', 'description', 'benefit', 'tradeoff'].every(key => string(o[key])), 'Each option needs its complete description and trade-offs.');
    insist(o.recommended === undefined || typeof o.recommended === 'boolean', 'Recommendation must be a label.');
    return { id: o.id, label: o.label, description: o.description, benefit: o.benefit, tradeoff: o.tradeoff, recommended: o.recommended === true };
  });
  return { id: q.id, revision: q.revision, title: q.title, context: q.context, type: q.type, options };
}

export function validateQuestionnaire(doc) {
  insist(doc && validId(doc.id) && string(doc.title) && doc.title.trim() && string(doc.description), 'Questionnaire details are invalid.');
  insist(Array.isArray(doc.questions) && doc.questions.length > 0 && doc.questions.length <= 100, 'Provide between 1 and 100 questions.');
  const questions = doc.questions.map(validateQuestion);
  insist(new Set(questions.map(q => q.id)).size === questions.length, 'Question IDs must be unique.');
  return { id: doc.id, title: doc.title, description: doc.description, questions };
}

export function initialState(doc) {
  return { schemaVersion: 1, questionnaire: validateQuestionnaire(doc), drafts: {}, submissions: [] };
}

export const hasAnswer = draft => Boolean(draft && (draft.optionIds.length || draft.text.trim()));
export const answerValue = draft => ({ optionIds: [...draft.optionIds], text: draft.text });
export const questionById = (state, id) => state.questionnaire.questions.find(q => q.id === id);
export const isStale = (state, id) => Boolean(state.drafts[id] && !equal(state.drafts[id].question, questionById(state, id)));
export function draftFor(state, id) {
  return state.drafts[id] || { question: copy(questionById(state, id)), optionIds: [], text: '', deferred: false, revision: 0, previous: [] };
}

function validateAnswer(question, answer) {
  insist(answer && Array.isArray(answer.optionIds) && answer.optionIds.every(validId) && string(answer.text), 'Invalid answer.');
  insist(new Set(answer.optionIds).size === answer.optionIds.length, 'An option cannot be selected twice.');
  insist(answer.optionIds.every(id => question.options.some(o => o.id === id)), 'An option in this answer no longer exists.');
  insist(question.type !== 'single' || answer.optionIds.length <= 1, 'Select one option for this question.');
  insist(question.type !== 'text' || answer.optionIds.length === 0, 'This question takes a written answer.');
}

export function statusFor(state, id) {
  const draft = state.drafts[id];
  if (!hasAnswer(draft)) return 'unanswered';
  const submitted = !isStale(state, id) && !draft.deferred && state.submissions.some(s => s.answers.some(a => a.question.id === id && equal(a.question, draft.question) && equal(a.answer, answerValue(draft))));
  return submitted ? 'submitted' : 'draft';
}

export function progress(state) {
  const counts = { total: state.questionnaire.questions.length, submitted: 0, draft: 0, unanswered: 0, deferred: 0, pending: 0 };
  for (const q of state.questionnaire.questions) {
    counts[statusFor(state, q.id)]++;
    if (state.drafts[q.id]?.deferred) counts.deferred++;
  }
  counts.pending = counts.total - counts.submitted;
  return counts;
}

export function canSubmit(state, id) {
  return Boolean(questionById(state, id) && hasAnswer(state.drafts[id]) && !isStale(state, id) && statusFor(state, id) !== 'submitted');
}

export function makeReview(state, ids, id, createdAt) {
  insist(validId(id) && string(createdAt, 100) && !Number.isNaN(Date.parse(createdAt)), 'Invalid submission identity.');
  insist(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length, 'Choose at least one answer to review.');
  insist(ids.every(qid => canSubmit(state, qid)), 'An answer is empty, already submitted, or needs review after a question update.');
  return {
    id, createdAt, questionnaireId: state.questionnaire.id, title: state.questionnaire.title,
    answers: ids.map(qid => ({ question: copy(questionById(state, qid)), answer: answerValue(state.drafts[qid]), draftRevision: state.drafts[qid].revision })),
  };
}

export function transition(state, action) {
  insist(action && typeof action.type === 'string', 'An explicit action is required.');
  if (action.type === 'definitions') {
    const questionnaire = validateQuestionnaire(action.questionnaire);
    insist(questionnaire.id === state.questionnaire.id, 'Use the same questionnaire ID; replacing a session is not supported.');
    return equal(questionnaire, state.questionnaire) ? state : { ...state, questionnaire };
  }
  if (action.type === 'submit') {
    const review = action.review;
    insist(review && Array.isArray(review.answers), 'Review the selected answers before submitting.');
    const existing = state.submissions.find(s => s.id === review.id);
    if (existing) { insist(equal(existing, review), 'Submission ID already belongs to different answers.'); return state; }
    const expected = makeReview(state, review.answers.map(a => a.question.id), review.id, review.createdAt);
    insist(equal(expected, review), 'The reviewed answers changed. Review them again before submitting.');
    const drafts = { ...state.drafts };
    for (const a of review.answers) drafts[a.question.id] = { ...drafts[a.question.id], deferred: false };
    return { ...state, drafts, submissions: [...state.submissions, copy(review)] };
  }
  insist(['edit', 'defer', 'adopt'].includes(action.type), 'Unknown action.');
  const question = questionById(state, action.questionId);
  insist(question, 'This question is no longer in the form. Your earlier draft is retained.');
  const old = draftFor(state, question.id);
  let draft = copy(old);
  if (action.type === 'defer') {
    insist(typeof action.deferred === 'boolean', 'Choose whether to defer this question.');
    draft.deferred = action.deferred;
  } else {
    const value = action.type === 'adopt' ? answerValue(old) : action.answer;
    validateAnswer(question, value);
    if (isStale(state, question.id)) {
      draft.previous.push({ question: copy(old.question), answer: answerValue(old) });
    }
    draft = { ...draft, question: copy(question), ...copy(value) };
  }
  draft.revision++;
  return { ...state, drafts: { ...state.drafts, [question.id]: draft } };
}

export function restoreState(raw) {
  insist(raw?.schemaVersion === 1 && raw.drafts && typeof raw.drafts === 'object' && !Array.isArray(raw.drafts) && Array.isArray(raw.submissions), 'Saved data is invalid or from an unsupported version.');
  const questionnaire = validateQuestionnaire(raw.questionnaire);
  for (const [id, draft] of Object.entries(raw.drafts)) {
    insist(validId(id) && draft?.question?.id === id, 'Saved draft identity is invalid.');
    const q = validateQuestion(draft.question);
    validateAnswer(q, draft);
    insist(typeof draft.deferred === 'boolean' && Number.isSafeInteger(draft.revision) && draft.revision >= 0 && Array.isArray(draft.previous), 'Saved draft is invalid.');
    for (const old of draft.previous) validateAnswer(validateQuestion(old.question), old.answer);
  }
  const seen = new Set();
  for (const s of raw.submissions) {
    insist(validId(s?.id) && !seen.has(s.id) && s.questionnaireId === questionnaire.id && string(s.title) && string(s.createdAt, 100) && !Number.isNaN(Date.parse(s.createdAt)) && Array.isArray(s.answers) && s.answers.length > 0, 'Saved submission is invalid.');
    seen.add(s.id);
    const questionIds = new Set();
    for (const a of s.answers) {
      validateAnswer(validateQuestion(a.question), a.answer);
      insist(!questionIds.has(a.question.id) && hasAnswer(a.answer) && Number.isSafeInteger(a.draftRevision) && a.draftRevision > 0, 'Saved submission answer is invalid.');
      questionIds.add(a.question.id);
    }
  }
  return { ...copy(raw), questionnaire };
}

export function formatSubmission(submission) {
  const lines = [`# ${submission.title}`, '', `Submission: ${submission.id}`, `Confirmed: ${submission.createdAt}`, '', 'Explicitly submitted answers', ''];
  for (const { question: q, answer } of submission.answers) {
    lines.push(`## ${q.title}`, `Question: ${q.id} · revision ${q.revision}`, q.context, '');
    for (const id of answer.optionIds) {
      const o = q.options.find(option => option.id === id);
      lines.push(`Selected: ${o.label} [${o.id}]`, o.description, `Benefit: ${o.benefit}`, `Trade-off: ${o.tradeoff}`, '');
    }
    if (answer.text) lines.push('Written answer:', answer.text, '');
  }
  return lines.join('\n').trim();
}
