import { transition, draftFor, questionById, hasAnswer, isStale, statusFor, progress, canSubmit, makeReview, formatSubmission } from '/core.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#review-dialog');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const capital = value => value[0].toUpperCase() + value.slice(1);
let state, version, currentId, running = false, error = '', conflict = false, connectionWarning = '';
let pending = [], review = null, reviewIds = [], shownSubmission = null;
let toastTimer, modalMode = '', refreshing = false, sidebarCollapsed = false;
const narrowViewport = matchMedia('(max-width: 640px)');
const iconPaths = {
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clear: '<path d="m4 13 9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-8 8H9l-5-4a2 2 0 0 1 0-3Z"/><path d="m8 9 9 9M13 20h8"/>',
  balance: '<path d="M12 3v17M7 21h10M4 7h16M6 7l-4 8h8L6 7Zm12 0-4 8h8l-4-8Z"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
  left: '<path d="m14 5-7 7 7 7"/>',
  right: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${iconPaths[name]}</svg>`;

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
  if (error) return 'Not saved · retry needed';
  if (connectionWarning) return 'Refresh unavailable · drafts retained';
  return pending.length ? 'Saving…' : 'Saved';
}

function badge(id) {
  const status = statusFor(state, id);
  return `<span class="badge ${status}">${capital(status)}</span>${state.drafts[id]?.deferred ? '<span class="badge deferred">Deferred</span>' : ''}`;
}

function renderChrome() {
  if (!state) return;
  const stats = progress(state);
  const save = document.querySelector('#save-state');
  if (save) { save.innerHTML = `${icon(error || connectionWarning || pending.length ? 'clock' : 'check')}<span>${escape(saveText())}</span>`; save.classList.toggle('warning', Boolean(error || connectionWarning || pending.length)); save.title = error || connectionWarning || (pending.length ? 'Saving your changes' : 'Saved on this computer'); }
  document.querySelector('#session-title').textContent = state.questionnaire.title;
  document.querySelector('#session-title').title = state.questionnaire.description;
  document.querySelector('#demo-label').hidden = !state.questionnaire.id.includes('demo');
  document.querySelector('#progress-label').innerHTML = `<strong>${stats.submitted}</strong> submitted`;
  const meter = document.querySelector('progress');
  meter.max = stats.total; meter.value = stats.submitted;
  document.querySelector('#footer-status').textContent = `${stats.pending} pending`;
  document.querySelector('#compact-progress').textContent = `${stats.submitted} submitted · ${stats.pending} pending`;
  const sidebar = document.querySelector('#sidebar-questions');
  const list = questionItems();
  if (sidebar.innerHTML !== list) { const scroll = sidebar.scrollTop; sidebar.innerHTML = list; sidebar.scrollTop = scroll; }
  document.querySelector('#question-badges').innerHTML = badge(currentId);
  document.querySelector('#history-button').textContent = `Submissions (${state.submissions.length})`;
  document.querySelector('#history-button').hidden = !state.submissions.length;
  document.querySelector('#open-review').disabled = !state.questionnaire.questions.some(q => canSubmit(state, q.id)) || Boolean(pending.length || error || connectionWarning);
  const warning = document.querySelector('#save-warning');
  warning.hidden = !error && !connectionWarning;
  warning.innerHTML = warning.hidden ? '' : `<p>${escape(error || connectionWarning)} Your work in this tab is retained. Unsaved changes will be lost if you close or reload it.</p><button class="button small" data-action="${conflict ? 'load-saved' : 'retry'}">${conflict ? 'Load saved version…' : 'Retry saving'}</button><button class="button small" data-action="recover">Download recovery copy</button>`;
}

function oldAnswer(draft) {
  return `${draft.question.title}\n${draft.question.context}\n\n${draft.optionIds.map(id => { const o = draft.question.options.find(item => item.id === id); return `${o.label}\n${o.description}\nBenefit: ${o.benefit}\nTrade-off: ${o.tradeoff}`; }).join('\n\n')}${draft.text ? `\n\n${draft.text}` : ''}`;
}

function render() {
  if (!state) return;
  const focused = document.activeElement;
  const textFocus = focused?.id === 'answer-text' ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
  const mainScroll = document.querySelector('.main')?.scrollTop || 0;
  const sidebarScroll = document.querySelector('#sidebar-questions')?.scrollTop || 0;
  currentId = questionById(state, currentId) ? currentId : state.questionnaire.questions[0].id;
  const q = questionById(state, currentId), draft = draftFor(state, currentId);
  const index = state.questionnaire.questions.findIndex(item => item.id === currentId);
  const stale = isStale(state, currentId) && hasAnswer(draft);
  const canAdopt = draft.optionIds.every(id => q.options.some(o => o.id === id)) && (q.type !== 'single' || draft.optionIds.length <= 1) && (q.type !== 'text' || !draft.optionIds.length);
  document.title = `${state.questionnaire.title} · Workbench`;
  app.innerHTML = `<div class="workspace">
    <aside class="sidebar" id="question-sidebar" aria-label="Question sidebar"><div class="sidebar-heading">Questions <span>${state.questionnaire.questions.length}</span></div><nav id="sidebar-questions" class="sidebar-questions" aria-label="Questions"></nav><div class="sidebar-summary"><progress class="progress-track" aria-label="Submitted questions" max="1" value="0"></progress><p><span id="progress-label"></span><span aria-hidden="true"> · </span><span id="footer-status"></span></p><button id="history-button" class="button sidebar-button" data-action="history" hidden></button></div></aside>
    <main class="main"><div class="form-content"><p class="compact-progress" id="compact-progress"></p>
    <div id="save-warning" class="alert" role="alert" hidden></div>
    <article class="question-sheet" id="question" aria-labelledby="question-title"><div class="question-meta"><span class="question-position">Question ${index + 1} of ${state.questionnaire.questions.length}</span><button class="button small question-selector" id="question-selector" data-action="questions" aria-haspopup="dialog" aria-controls="review-dialog">Question ${index + 1} of ${state.questionnaire.questions.length} <span aria-hidden="true">▾</span></button><span id="question-badges"></span></div><h1 id="question-title" tabindex="-1">${escape(q.title)}</h1><p class="question-context">${escape(q.context)}</p>
    ${stale ? `<div class="alert"><p><strong>This question was updated.</strong> Your earlier answer is kept below. ${canAdopt ? 'Review the new wording, then keep or edit your answer.' : 'An earlier choice is no longer available. Choose a new answer to continue.'}</p><details><summary>Earlier question and answer</summary><div class="old-answer">${escape(oldAnswer(draft))}</div></details>${canAdopt ? '<button class="button small" data-action="adopt">Keep my answer with this wording</button>' : ''}</div>` : ''}
    ${q.type !== 'text' ? `<p class="answer-hint">${q.type === 'single' ? 'Choose one, or write your own answer below.' : 'Choose any that apply, or write your own answer below.'}</p><fieldset class="options" aria-labelledby="question-title">${q.options.map(o => `<label class="option ${draft.optionIds.includes(o.id) ? 'selected' : ''}" id="option-${escape(q.id)}-${escape(o.id)}"><span class="option-top"><input type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="answer-option" value="${escape(o.id)}" ${draft.optionIds.includes(o.id) ? 'checked' : ''} aria-labelledby="label-${escape(q.id)}-${escape(o.id)}"><span class="option-title" id="label-${escape(q.id)}-${escape(o.id)}">${escape(o.label)}</span>${o.recommended ? '<span class="badge recommended">Recommended</span>' : ''}</span><div class="option-body"><p class="option-description">${escape(o.description)}</p><div class="tradeoffs"><p><strong class="offers">${icon('check')} Offers</strong><span>${escape(o.benefit)}</span></p><p><strong class="tradeoff">${icon('balance')} Trade-off</strong><span>${escape(o.tradeoff)}</span></p></div></div></label>`).join('')}</fieldset>` : ''}
    <label for="answer-text" class="field-label">${q.type === 'text' ? 'Your answer' : 'Your own answer or a note <span class="optional">Optional</span>'}</label><textarea id="answer-text" maxlength="20000" rows="${q.type === 'text' ? 7 : 3}">${escape(draft.text)}</textarea>
    <div class="question-actions"><button class="button" data-action="defer">${icon('clock')}${draft.deferred ? 'Resume question' : 'Answer later'}</button><button class="button" data-action="clear" ${hasAnswer(draft) ? '' : 'disabled'}>${icon('clear')}Clear answer</button></div></article></div></main>
    </div><footer class="footer-bar"><nav class="footer-buttons ${index === state.questionnaire.questions.length - 1 ? 'last-question' : ''}" aria-label="Question navigation"><button class="button previous-question" ${index > 0 ? `data-go="${escape(state.questionnaire.questions[index - 1].id)}"` : 'disabled'} aria-label="Previous question">${icon('left')}<span>Previous</span></button><button class="button ${index === state.questionnaire.questions.length - 1 ? 'primary' : ''}" id="open-review" data-action="review">${icon('list')}Review answers</button>${index < state.questionnaire.questions.length - 1 ? `<button class="button primary" data-go="${escape(state.questionnaire.questions[index + 1].id)}">Next question ${icon('right')}</button>` : ''}</nav></footer>`;
  renderChrome();
  document.querySelector('.main').scrollTop = mainScroll;
  document.querySelector('#sidebar-questions').scrollTop = sidebarScroll;
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
  document.querySelector('.main').scrollTop = 0;
  document.querySelector('#sidebar-questions [aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
  document.querySelector('#question-title').focus({ preventScroll: true });
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
  if (action === 'questions') showQuestions();
  if (action === 'history') showHistory();
  if (action === 'recover') downloadRecovery();
  if (action === 'retry') retry();
  if (action === 'load-saved') loadSaved();
});

function openDialog(html, mode) {
  modalMode = mode;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  const heading = dialog.querySelector('#dialog-title');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}
const dialogHead = (title, description = '') => `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${description ? `<p>${description}</p>` : ''}</div><button class="close" data-modal="close" aria-label="Close dialog">×</button></div>`;

function showQuestions() {
  const stats = progress(state);
  openDialog(`${dialogHead('Questions', `${stats.submitted} submitted · ${stats.pending} pending`)}<nav class="question-list" aria-label="All questions">${questionItems()}</nav>`, 'questions');
  dialog.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
}

function questionItems() {
  return state.questionnaire.questions.map((q, index) => {
    const status = statusFor(state, q.id);
    const deferred = state.drafts[q.id]?.deferred;
    const updated = isStale(state, q.id) && hasAnswer(state.drafts[q.id]);
    return `<button class="nav-item ${q.id === currentId ? 'active' : ''} ${status} ${deferred ? 'deferred' : ''}" data-go="${escape(q.id)}" title="${escape(q.title)}" ${q.id === currentId ? 'aria-current="step"' : ''}><span class="nav-dot" aria-hidden="true">${status === 'submitted' ? '✓' : ''}</span><span class="nav-number">${String(index + 1).padStart(2, '0')}</span><span class="nav-text"><span class="nav-title">${escape(state.questionnaire.navigationLabels?.[q.id] || q.title)}</span><span class="nav-status">${deferred ? 'Deferred · ' : ''}${capital(status)}${updated ? ' · Updated' : ''}</span></span></button>`;
  }).join('');
}

function updateSidebarToggle() {
  document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  const toggle = document.querySelector('#toggle-sidebar');
  toggle.setAttribute('aria-expanded', String(!sidebarCollapsed && !narrowViewport.matches));
  toggle.setAttribute('aria-label', narrowViewport.matches ? 'Show questions' : sidebarCollapsed ? 'Show question sidebar' : 'Hide question sidebar');
}
document.querySelector('#toggle-sidebar').addEventListener('click', () => {
  if (!state) return;
  if (narrowViewport.matches) return showQuestions();
  sidebarCollapsed = !sidebarCollapsed;
  updateSidebarToggle();
});
narrowViewport.addEventListener('change', updateSidebarToggle);
updateSidebarToggle();

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
  const go = event.target.closest('[data-go]');
  if (go) { dialog.close(); navigate(go.dataset.go); return; }
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
dialog.addEventListener('close', () => {
  const wasQuestionPicker = modalMode === 'questions';
  modalMode = '';
  const returnTarget = wasQuestionPicker ? document.querySelector('#question-selector') : document.querySelector('#open-review:not(:disabled)') || document.querySelector('#history-button:not([hidden])') || document.querySelector('#answer-text');
  returnTarget?.focus({ preventScroll: true });
});

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
    if (running || pending.length || conflict || result.version < version) return;
    connectionWarning = '';
    if (result.version !== version) {
      state = result.state; version = result.version;
      if (modalMode === 'review') { dialog.close(); review = null; toast('The form changed. Review your answers again before submitting.'); }
      render();
      if (modalMode === 'questions') showQuestions();
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
