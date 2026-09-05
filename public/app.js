import { transition, draftFor, questionById, hasAnswer, isStale, statusFor, progress, canSubmit, makeReview, formatSubmission } from '/core.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#review-dialog');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const capital = value => value[0].toUpperCase() + value.slice(1);
let state, version, currentId, running = false, error = '', conflict = false, connectionWarning = '';
let pending = [], review = null, reviewIds = [], shownSubmission = null;
let toastTimer, modalMode = '', refreshing = false;

function toast(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = message;
  notice.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { notice.hidden = true; }, 5000);
}

async function request(path, options) {
  const response = await fetch(path, { cache: 'no-store', signal: AbortSignal.timeout(10000), ...options });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'The local server could not complete this request.'), { status: response.status });
  return data;
}

function saveText() {
  if (error || connectionWarning) return 'Not saved · connection needs attention';
  return pending.length ? 'Saving…' : 'Saved on this computer';
}

function badge(id) {
  const status = statusFor(state, id);
  return `<span class="badge ${status}">${capital(status)}</span>${state.drafts[id]?.deferred ? '<span class="badge deferred">Deferred</span>' : ''}`;
}

function renderChrome() {
  if (!state) return;
  const stats = progress(state);
  const nav = document.querySelector('.question-nav');
  if (nav) nav.innerHTML = state.questionnaire.questions.map((q, index) => `<button class="nav-item ${q.id === currentId ? 'active' : ''} ${statusFor(state, q.id) === 'submitted' ? 'done' : ''}" data-go="${escape(q.id)}" ${q.id === currentId ? 'aria-current="step"' : ''}><span class="nav-number">${statusFor(state, q.id) === 'submitted' ? '✓' : String(index + 1).padStart(2, '0')}</span><span><span class="nav-title">${escape(q.title)}</span><span class="nav-status">${state.drafts[q.id]?.deferred ? 'Deferred · ' : ''}${capital(statusFor(state, q.id))}${isStale(state, q.id) && hasAnswer(state.drafts[q.id]) ? ' · Updated' : ''}</span></span></button>`).join('');
  const save = document.querySelector('#save-state');
  if (save) { save.textContent = saveText(); save.classList.toggle('warning', Boolean(error || connectionWarning || pending.length)); }
  document.querySelector('#progress-label').textContent = `${stats.submitted} of ${stats.total} submitted`;
  const meter = document.querySelector('progress');
  meter.max = stats.total; meter.value = stats.submitted;
  document.querySelector('#footer-status').textContent = `${stats.pending} question${stats.pending === 1 ? '' : 's'} pending${pending.length ? ' · Unsaved changes' : ''}`;
  document.querySelector('#question-badges').innerHTML = badge(currentId);
  document.querySelector('#history-button').textContent = `Submissions (${state.submissions.length})`;
  document.querySelector('#history-button').hidden = !state.submissions.length;
  document.querySelector('#open-review').disabled = !state.questionnaire.questions.some(q => canSubmit(state, q.id)) || Boolean(pending.length || error || connectionWarning);
  const warning = document.querySelector('#save-warning');
  warning.hidden = !error && !connectionWarning;
  warning.innerHTML = warning.hidden ? '' : `<p>${escape(error || connectionWarning)} Your work in this tab is retained. Unsaved changes will be lost if you close or reload it.</p><button class="button small" data-action="${conflict ? 'load-saved' : 'retry'}">${conflict ? 'Load saved version…' : 'Retry saving'}</button><button class="button small" data-action="recover">Download recovery copy</button>`;
}

function oldAnswer(draft) {
  return `${draft.question.title}\n\n${draft.optionIds.map(id => { const o = draft.question.options.find(item => item.id === id); return `${o.label}\n${o.description}\nBenefit: ${o.benefit}\nTrade-off: ${o.tradeoff}`; }).join('\n\n')}${draft.text ? `\n\n${draft.text}` : ''}`;
}

function render() {
  if (!state) return;
  const focused = document.activeElement;
  const textFocus = focused?.id === 'answer-text' ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
  currentId = questionById(state, currentId) ? currentId : state.questionnaire.questions[0].id;
  const q = questionById(state, currentId), draft = draftFor(state, currentId);
  const index = state.questionnaire.questions.findIndex(item => item.id === currentId);
  const stale = isStale(state, currentId) && hasAnswer(draft);
  const canAdopt = draft.optionIds.every(id => q.options.some(o => o.id === id)) && (q.type !== 'single' || draft.optionIds.length <= 1) && (q.type !== 'text' || !draft.optionIds.length);
  document.title = `${state.questionnaire.title} · Workbench`;
  app.innerHTML = `<div class="workspace">
    <aside class="sidebar"><div class="side-inner"><div class="eyebrow">Your questions</div><nav class="question-nav" aria-label="Questions"></nav><p class="side-note">Take them in any order.<br>Your choices stay as drafts until you submit them.</p></div></aside>
    <main class="main"><section class="session-heading"><span class="eyebrow">Sample interview · ${state.questionnaire.questions.length} questions</span><h1>${escape(state.questionnaire.title)}</h1><p class="session-description">${escape(state.questionnaire.description)}</p><div class="progress-row"><span id="progress-label"></span><span id="save-state" class="save-indicator" role="status" aria-live="polite"></span></div><progress class="progress-track" aria-label="Submitted questions" max="1" value="0"></progress></section>
    <div id="save-warning" class="alert" role="alert" hidden></div>
    <article class="question-sheet" id="question" aria-labelledby="question-title"><div class="question-meta"><span class="eyebrow">Question ${String(index + 1).padStart(2, '0')}</span><span id="question-badges"></span></div><h2 id="question-title">${escape(q.title)}</h2><p class="question-context">${escape(q.context)}</p>
    ${stale ? `<div class="alert"><p><strong>This question was updated.</strong> Your earlier answer is kept below. ${canAdopt ? 'Review the new wording, then keep or edit your answer.' : 'An earlier choice is no longer available. Choose a new answer to continue.'}</p><details><summary>Earlier question and answer</summary><div class="old-answer">${escape(oldAnswer(draft))}</div></details>${canAdopt ? '<button class="button small" data-action="adopt">Keep my answer with this wording</button>' : ''}</div>` : ''}
    ${q.type !== 'text' ? `<p class="answer-hint">${q.type === 'single' ? 'Choose one, or write your own answer below.' : 'Choose any that apply, or write your own answer below.'}</p><fieldset class="options" aria-labelledby="question-title">${q.options.map(o => `<label class="option ${draft.optionIds.includes(o.id) ? 'selected' : ''}" id="option-${escape(q.id)}-${escape(o.id)}"><span class="option-top"><input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="answer-option" value="${escape(o.id)}" ${draft.optionIds.includes(o.id) ? 'checked' : ''} aria-labelledby="label-${escape(q.id)}-${escape(o.id)}"><span class="option-title" id="label-${escape(q.id)}-${escape(o.id)}">${escape(o.label)}</span>${o.recommended ? '<span class="badge recommended">Recommended</span>' : ''}</span><div class="option-body"><p class="option-description">${escape(o.description)}</p><div class="tradeoffs"><p><strong>What it offers</strong>${escape(o.benefit)}</p><p><strong>The trade-off</strong>${escape(o.tradeoff)}</p></div></div></label>`).join('')}</fieldset>` : ''}
    <label for="answer-text" class="field-label">${q.type === 'text' ? 'Your answer' : 'Your own answer or a note <span class="optional">· optional</span>'}</label><textarea id="answer-text" maxlength="20000" rows="${q.type === 'text' ? 7 : 3}" placeholder="${q.type === 'text' ? 'What would you hope to notice?' : 'Add what matters to your choice…'}">${escape(draft.text)}</textarea>
    <div class="question-actions"><div><button class="text-button" data-action="defer">${draft.deferred ? 'Resume question' : 'Answer later'}</button>${hasAnswer(draft) ? ' <button class="text-button" data-action="clear">Clear answer</button>' : ''}</div><div>${index > 0 ? `<button class="button" data-go="${escape(state.questionnaire.questions[index - 1].id)}" aria-label="Previous question">←</button>` : ''} ${index < state.questionnaire.questions.length - 1 ? `<button class="button" data-go="${escape(state.questionnaire.questions[index + 1].id)}">Next question <span aria-hidden="true">→</span></button>` : ''}</div></div></article></main>
    </div><footer class="footer-bar"><div class="footer-inner"><span id="footer-status" class="footer-copy"></span><div class="footer-buttons"><button id="history-button" class="button" data-action="history" hidden></button><button class="button primary" id="open-review" data-action="review">Review answers <span aria-hidden="true">↗</span></button></div></div></footer>`;
  renderChrome();
  if (textFocus) { const field = document.querySelector('#answer-text'); field.focus({ preventScroll: true }); field.setSelectionRange(textFocus.start, textFocus.end); }
}

function stage(action, redraw = true) {
  try { state = transition(state, action); }
  catch (failure) { toast(failure.message); return; }
  pending.push({ requestId: crypto.randomUUID(), action });
  if (redraw) render(); else renderChrome();
  void flush();
}

async function flush() {
  if (running || conflict) return;
  running = true;
  try {
    while (pending.length) {
      const item = pending[0];
      item.version ??= version;
      const result = await request('/api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
      version = result.version;
      pending.shift();
      if (!pending.length) state = result.state;
      error = ''; connectionWarning = '';
      renderChrome();
    }
  } catch (failure) {
    error = failure.message;
    conflict = failure.status === 409;
  } finally {
    running = false;
    renderChrome();
    if (modalMode === 'saving') {
      if (pending.length || error) renderSaveFailure();
      else showSubmission(shownSubmission);
    }
  }
}

function navigate(id) {
  currentId = id;
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  render();
  document.querySelector('#question').scrollIntoView({ block: 'start', behavior: 'instant' });
}

function readAnswer() {
  return { optionIds: [...document.querySelectorAll('input[name="answer-option"]:checked')].map(input => input.value), text: document.querySelector('#answer-text').value };
}

app.addEventListener('input', event => {
  if (event.target.id === 'answer-text') stage({ type: 'edit', questionId: currentId, answer: readAnswer() }, false);
});
app.addEventListener('change', event => {
  if (event.target.name === 'answer-option') {
    const optionId = event.target.value;
    stage({ type: 'edit', questionId: currentId, answer: readAnswer() });
    [...document.querySelectorAll('[name="answer-option"]')].find(input => input.value === optionId)?.focus({ preventScroll: true });
  }
});
app.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (go) return navigate(go.dataset.go);
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'defer') stage({ type: 'defer', questionId: currentId, deferred: !draftFor(state, currentId).deferred });
  if (action === 'clear') stage({ type: 'edit', questionId: currentId, answer: { optionIds: [], text: '' } });
  if (action === 'adopt') stage({ type: 'adopt', questionId: currentId });
  if (action === 'review') openReview();
  if (action === 'history') showHistory();
  if (action === 'recover') downloadRecovery();
  if (action === 'retry') retry();
  if (action === 'load-saved') loadSaved();
});

function openDialog(html, mode) {
  modalMode = mode;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
const dialogHead = (title, description = '') => `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${description ? `<p>${description}</p>` : ''}</div><button class="close" data-modal="close" aria-label="Close dialog">×</button></div>`;

function openReview() {
  reviewIds = []; review = null;
  openDialog(`${dialogHead('Review your answers', 'Choose exactly which answers to submit. Everything else stays pending.')}<div class="dialog-body"><div id="review-choices">${state.questionnaire.questions.filter(q => canSubmit(state, q.id)).map(q => { const draft = draftFor(state, q.id); return `<div class="review-choice"><input type="checkbox" id="review-${escape(q.id)}" data-review="${escape(q.id)}"><label for="review-${escape(q.id)}"><strong>${escape(q.title)}</strong><span>${escape(draft.optionIds.map(id => q.options.find(o => o.id === id).label).join(' · '))}${draft.text ? `${draft.optionIds.length ? '\n' : ''}${escape(draft.text)}` : ''}</span></label></div>`; }).join('')}</div><div id="review-preview"></div></div><div class="dialog-foot"><button class="button" data-modal="close">Keep editing</button><button class="button primary" id="submit-button" data-modal="submit" disabled>Submit selected answers</button></div>`, 'review');
  updateReview();
}

function updateReview() {
  review = reviewIds.length ? makeReview(state, reviewIds, crypto.randomUUID(), new Date().toISOString()) : null;
  const pendingQuestions = state.questionnaire.questions.filter(q => !reviewIds.includes(q.id) && statusFor(state, q.id) !== 'submitted');
  document.querySelector('#review-preview').innerHTML = `${review ? `<h3 class="field-label">Exact submission</h3><pre class="export-text">${escape(formatSubmission(review))}</pre>` : '<p class="muted">No answers selected.</p>'}<p class="pending-list"><strong>Remaining pending (${pendingQuestions.length})</strong><br>${pendingQuestions.map(q => escape(q.title)).join('<br>') || 'None'}</p>`;
  const button = document.querySelector('#submit-button');
  button.disabled = !review || Boolean(pending.length || error);
  button.textContent = review ? `Submit ${reviewIds.length} answer${reviewIds.length === 1 ? '' : 's'}` : 'Submit selected answers';
}

function submitReview() {
  if (!review || pending.length || error) return;
  shownSubmission = structuredClone(review);
  openDialog(`${dialogHead('Saving your submission')}<div class="dialog-body"><p role="status">Saving the answers you confirmed…</p></div>`, 'saving');
  stage({ type: 'submit', review });
}

function renderSaveFailure() {
  openDialog(`${dialogHead('Your submission is not saved yet')}<div class="dialog-body"><p>Your confirmed answers are retained in this tab. ${escape(error)}</p><p>Keep this page open or download a recovery copy before leaving.</p><button class="button" data-modal="recover">Download recovery copy</button></div><div class="dialog-foot"><button class="button" data-modal="close">Back to form</button>${!conflict ? '<button class="button primary" data-modal="retry">Retry saving</button>' : ''}</div>`, 'save-failed');
}

function showSubmission(submission) {
  shownSubmission = submission;
  openDialog(`${dialogHead(`${submission.answers.length} answer${submission.answers.length === 1 ? '' : 's'} submitted`, 'Saved on this computer. Copy these answers into your existing chat when you are ready.')}<div class="dialog-body"><div class="success-symbol" aria-hidden="true">✓</div><p>Only the answers below are included.</p><label class="field-label" for="handoff-text">Submission for chat</label><textarea id="handoff-text" class="export-text" readonly rows="11">${escape(formatSubmission(submission))}</textarea><p class="pending-list" id="copy-status" role="status">Copying does not send a message to chat.</p></div><div class="dialog-foot"><button class="button" data-modal="close">Continue answering</button><button class="button primary" data-modal="copy">Copy for chat</button></div>`, 'submission');
  render();
}

function showHistory() {
  const saved = state.submissions.filter(s => !pending.some(item => item.action.type === 'submit' && item.action.review.id === s.id));
  openDialog(`${dialogHead('Submitted answers', 'Earlier submissions keep their original questions and answers.')}<div class="dialog-body">${saved.map(s => `<button class="history-item" data-submission="${escape(s.id)}"><strong>${s.answers.length} answer${s.answers.length === 1 ? '' : 's'} · ${escape(new Date(s.createdAt).toLocaleString())}</strong><span>${s.answers.map(a => escape(a.question.title)).join('<br>')}</span></button>`).join('') || '<p>No saved submissions yet.</p>'}</div>`, 'history');
}

dialog.addEventListener('change', event => {
  if (event.target.dataset.review) {
    reviewIds = [...dialog.querySelectorAll('[data-review]:checked')].map(input => input.dataset.review);
    updateReview();
  }
});
dialog.addEventListener('click', async event => {
  const prior = event.target.closest('[data-submission]');
  if (prior) return showSubmission(state.submissions.find(s => s.id === prior.dataset.submission));
  const action = event.target.closest('[data-modal]')?.dataset.modal;
  if (action === 'close') dialog.close();
  if (action === 'submit') submitReview();
  if (action === 'recover') downloadRecovery();
  if (action === 'retry') { modalMode = 'saving'; retry(); }
  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(formatSubmission(shownSubmission));
      document.querySelector('#copy-status').textContent = 'Copied. Paste into your chat to share these answers.';
    } catch {
      const field = document.querySelector('#handoff-text'); field.focus(); field.select();
      document.querySelector('#copy-status').textContent = 'Clipboard access failed. The text is selected; copy it manually. Your submission is still saved.';
    }
  }
});
dialog.addEventListener('close', () => { modalMode = ''; });

function downloadRecovery() {
  const blob = new Blob([JSON.stringify({ version, state, pending }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = 'workbench-recovery.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function retry() {
  error = ''; connectionWarning = '';
  if (pending.length) await flush(); else await refresh();
  renderChrome();
}

async function loadSaved() {
  if (!confirm('Replace this tab’s unsaved changes with the saved version? Download a recovery copy first if you want to keep them.')) return;
  try {
    const result = await request('/api/session');
    state = result.state; version = result.version; pending = []; error = ''; conflict = false; connectionWarning = '';
    dialog.close(); render();
  } catch (failure) { error = failure.message; renderChrome(); }
}

async function refresh() {
  if (running || pending.length || conflict || refreshing) return;
  refreshing = true;
  try {
    const result = await request('/api/session');
    // A poll begun before typing must never replace a newly staged answer.
    if (running || pending.length || conflict) return;
    connectionWarning = '';
    if (result.version !== version) {
      state = result.state; version = result.version;
      if (modalMode === 'review') { dialog.close(); review = null; toast('The form changed. Review your answers again before submitting.'); }
      render();
    } else renderChrome();
  } catch (failure) { connectionWarning = failure.message; renderChrome(); }
  finally { refreshing = false; }
}

async function start() {
  try {
    const result = await request('/api/session'); state = result.state; version = result.version;
    currentId = decodeURIComponent(location.hash.slice(1)) || state.questionnaire.questions[0].id;
    render();
    setInterval(refresh, 2500);
  } catch (failure) {
    app.innerHTML = `<div class="loading alert"><h1>Could not open the form</h1><p>${escape(failure.message)}</p><button class="button" id="retry-start">Try again</button></div>`;
    document.querySelector('#retry-start').addEventListener('click', start);
  }
}
window.addEventListener('beforeunload', event => { if (pending.length) { event.preventDefault(); event.returnValue = ''; } });
void start();
