import { transition, draftFor, questionById, hasAnswer, isStale, statusFor, progress, formSubmitted, makeReview as makeSubmission, formatSubmission } from '/core.js';
import { createKeyboard } from '/keyboard.js';

const app = document.querySelector('#app');
const dialog = document.querySelector('#app-dialog');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
let state, version, currentId, running = false, error = '', conflict = false, connectionWarning = '';
let pending = [], shownSubmission = null, receivedIds = new Set();
let toastTimer, modalMode = '', refreshing = false, sidebarCollapsed = false;
let dialogReturnFocus = null;
let vimEnabled = true;
try { vimEnabled = localStorage.getItem('workbench-vim') !== 'off'; } catch { /* Storage can be unavailable in embedded browsers. */ }
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

function rememberFocus(root) {
  const element = document.activeElement;
  if (!element || !root.contains(element)) return null;
  const attribute = ['id', 'data-action', 'data-go', 'data-modal', 'data-submission'].find(name => element.hasAttribute(name));
  if (!attribute) return null;
  const region = element.closest('.footer-bar, #sidebar-questions');
  const prefix = region ? (region.id ? `#${region.id} ` : '.footer-bar ') : '';
  return {
    selector: `${prefix}[${attribute}="${CSS.escape(element.getAttribute(attribute))}"]`,
    selection: element.id === 'answer-text' ? [element.selectionStart, element.selectionEnd, element.selectionDirection] : null,
  };
}

function restoreFocus(saved, root = document) {
  const element = saved && root.querySelector(saved.selector);
  if (!element || element.disabled || !element.getClientRects().length) return false;
  element.focus({ preventScroll: true });
  if (saved.selection) element.setSelectionRange(...saved.selection);
  return true;
}

function replaceContent(element, html) {
  if (element.innerHTML === html) return;
  const focused = rememberFocus(element), scroll = element.scrollTop;
  element.innerHTML = html;
  element.scrollTop = scroll;
  if (focused && !restoreFocus(focused)) focusControl(document.querySelector('#question-title'));
}

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
  if (error) return 'Not saved';
  if (connectionWarning) return 'Refresh unavailable';
  return pending.length ? 'Saving…' : 'Saved';
}

function badge(id) {
  return `<span class="badge">${hasAnswer(state.drafts[id]) ? 'Answered' : 'Not answered'}</span>`;
}

function renderChrome() {
  if (!state) return;
  const stats = progress(state);
  const save = document.querySelector('#save-state');
  if (save) { save.innerHTML = `${icon(error || connectionWarning || pending.length ? 'clock' : 'check')}<span>${escape(saveText())}</span>`; save.classList.toggle('warning', Boolean(error || connectionWarning || pending.length)); save.title = error || connectionWarning || (pending.length ? 'Saving your changes' : 'Saved on this computer'); }
  document.querySelector('#session-title').textContent = state.questionnaire.title;
  document.querySelector('#session-title').title = state.questionnaire.description;
  document.querySelector('#demo-label').hidden = !state.questionnaire.id.includes('demo');
  document.querySelector('#progress-label').innerHTML = `<strong>${stats.answered} of ${stats.total}</strong> answered`;
  const meter = document.querySelector('progress');
  meter.max = stats.total; meter.value = stats.answered;
  meter.setAttribute('aria-label', 'Answered questions');
  document.querySelector('#footer-status').textContent = formSubmitted(state) ? 'Form submitted' : `${stats.total - stats.answered} not answered`;
  document.querySelector('#compact-progress').textContent = `${stats.answered} of ${stats.total} answered · ${formSubmitted(state) ? 'Form submitted' : `${stats.total - stats.answered} not answered`}`;
  const sidebar = document.querySelector('#sidebar-questions');
  const list = questionItems();
  replaceContent(sidebar, list);
  document.querySelector('#question-badges').innerHTML = badge(currentId);
  document.querySelector('[data-action="clear"]').disabled = !hasAnswer(draftFor(state, currentId));
  document.querySelector('#history-button').textContent = `Submissions (${state.submissions.length})`;
  document.querySelector('#history-button').hidden = !state.submissions.length;
  // Draft autosaves must not toggle the submit button while the user types.
  document.querySelector('#submit-form').disabled = conflict || pending.some(item => item.action.type === 'submit');
  const warning = document.querySelector('#save-warning');
  warning.hidden = !error && !connectionWarning;
  replaceContent(warning, warning.hidden ? '' : `<p>${escape(error || connectionWarning)} Your work in this tab is retained. Unsaved changes will be lost if you close or reload it.</p><button class="button small" data-action="${conflict ? 'load-saved' : 'retry'}">${conflict ? 'Load saved version…' : 'Retry saving'}</button><button class="button small" data-action="recover">Download recovery copy</button>`);
}

function oldAnswer(draft) {
  return `${draft.question.title}\n${draft.question.context}\n\n${draft.optionIds.map(id => { const o = draft.question.options.find(item => item.id === id); return `${o.label}\n${o.description}\nBenefit: ${o.benefit}\nTrade-off: ${o.tradeoff}`; }).join('\n\n')}${draft.text ? `\n\n${draft.text}` : ''}`;
}

function render() {
  if (!state) return;
  const focused = rememberFocus(app);
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
    <article class="question-sheet" id="question" aria-labelledby="question-title"><div class="question-meta"><span class="question-position">Question ${index + 1} of ${state.questionnaire.questions.length}</span><button class="button small question-selector" id="question-selector" data-action="questions" aria-haspopup="dialog" aria-controls="app-dialog">Question ${index + 1} of ${state.questionnaire.questions.length} <span aria-hidden="true">▾</span></button><span id="question-badges"></span></div><h1 id="question-title" tabindex="-1">${escape(q.title)}</h1><p class="question-context">${escape(q.context)}</p>
    ${stale ? `<div class="alert"><p><strong>This question was updated.</strong> Your earlier answer is kept below. ${canAdopt ? 'Review the new wording, then keep or edit your answer.' : 'An earlier choice is no longer available. Choose a new answer to continue.'}</p><details><summary id="earlier-answer">Earlier question and answer</summary><div class="old-answer">${escape(oldAnswer(draft))}</div></details>${canAdopt ? '<button class="button small" data-action="adopt">Keep my answer with this wording</button>' : ''}</div>` : ''}
    ${q.type !== 'text' ? `<p class="answer-hint">${q.type === 'single' ? 'Choose one, or write your own answer below.' : 'Choose any that apply, or write your own answer below.'}</p><fieldset class="options" aria-labelledby="question-title">${q.options.map((o, optionIndex) => `<label class="option ${draft.optionIds.includes(o.id) ? 'selected' : ''}" id="option-${escape(q.id)}-${escape(o.id)}"><span class="option-top"><input id="answer-option-${escape(q.id)}-${escape(o.id)}" type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="answer-option" value="${escape(o.id)}" ${draft.optionIds.includes(o.id) ? 'checked' : ''} aria-labelledby="label-${escape(q.id)}-${escape(o.id)}"><span class="option-title" id="label-${escape(q.id)}-${escape(o.id)}">${escape(o.label)}</span>${optionIndex < 9 ? `<kbd class="option-key" aria-hidden="true">${optionIndex + 1}</kbd>` : ''}${o.recommended ? '<span class="badge recommended">Recommended</span>' : ''}</span><div class="option-body"><p class="option-description">${escape(o.description)}</p><div class="tradeoffs"><p><strong class="offers">${icon('check')} Offers</strong><span>${escape(o.benefit)}</span></p><p><strong class="tradeoff">${icon('balance')} Trade-off</strong><span>${escape(o.tradeoff)}</span></p></div></div></label>`).join('')}</fieldset>` : ''}
    <label for="answer-text" class="field-label">${q.type === 'text' ? 'Your answer' : 'Your answer <span class="optional">In your own words</span>'}</label><textarea id="answer-text" aria-describedby="answer-keyboard-hint" maxlength="20000" rows="${q.type === 'text' ? 7 : 3}">${escape(draft.text)}</textarea><p class="field-hint" id="answer-keyboard-hint">Type normally. <kbd>Esc</kbd> returns to navigation.</p>
    <div class="question-actions"><button class="button" data-action="defer">${icon('clock')}Answer later</button><button class="button" data-action="clear" ${hasAnswer(draft) ? '' : 'disabled'}>${icon('clear')}Clear answer</button></div></article></div></main>
    </div><footer class="footer-bar"><div class="keyboard-bar"><span id="keyboard-mode" class="keyboard-mode" role="status"></span><span class="keyboard-hint"><kbd>↑</kbd> / <kbd>↓</kbd> move · <kbd>←</kbd> / <kbd>→</kbd> questions</span><button class="keyboard-help" data-action="keys" aria-haspopup="dialog" aria-controls="app-dialog">Keys <kbd>?</kbd></button></div><nav class="footer-buttons ${index === state.questionnaire.questions.length - 1 ? 'last-question' : ''}" aria-label="Question navigation"><button class="button previous-question" ${index > 0 ? `data-go="${escape(state.questionnaire.questions[index - 1].id)}"` : 'disabled'} aria-label="Previous question">${icon('left')}<span>Previous</span></button><button class="button ${index === state.questionnaire.questions.length - 1 ? 'primary' : ''}" id="submit-form" data-action="submit">${icon('check')}Submit form</button>${index < state.questionnaire.questions.length - 1 ? `<button class="button primary" data-go="${escape(state.questionnaire.questions[index + 1].id)}">Next question ${icon('right')}</button>` : ''}</nav></footer>`;
  renderChrome();
  document.querySelector('.main').scrollTop = mainScroll;
  document.querySelector('#sidebar-questions').scrollTop = sidebarScroll;
  if (focused && !restoreFocus(focused)) focusControl(document.querySelector('#question-title'));
  updateKeyboardMode();
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
  if (action === 'defer') {
    const index = state.questionnaire.questions.findIndex(q => q.id === currentId);
    if (index < state.questionnaire.questions.length - 1) navigate(state.questionnaire.questions[index + 1].id);
    else showQuestions();
  }
  if (action === 'clear') stage({ type: 'edit', questionId: currentId, answer: { optionIds: [], text: '' } });
  if (action === 'adopt') stage({ type: 'adopt', questionId: currentId });
  if (action === 'submit') submitForm();
  if (action === 'questions') showQuestions();
  if (action === 'history') showHistory();
  if (action === 'keys') showKeys();
  if (action === 'recover') downloadRecovery();
  if (action === 'retry') retry();
  if (action === 'load-saved') loadSaved();
});

function openDialog(html, mode) {
  const focused = dialog.open && modalMode === mode ? rememberFocus(dialog) : null;
  if (!dialog.open) dialogReturnFocus = rememberFocus(document);
  modalMode = mode;
  dialog.innerHTML = html;
  if (!dialog.open) dialog.showModal();
  const heading = dialog.querySelector('#dialog-title');
  heading.tabIndex = -1;
  if (!restoreFocus(focused, dialog)) heading.focus({ preventScroll: true });
}
const dialogHead = (title, description = '') => `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${description ? `<p>${description}</p>` : ''}</div><button class="close" data-modal="close" aria-label="Close dialog">×</button></div>`;

function showQuestions() {
  const stats = progress(state);
  openDialog(`${dialogHead('Questions', `${stats.answered} of ${stats.total} answered · ${stats.total - stats.answered} not answered`)}<nav class="question-list" aria-label="All questions">${questionItems()}</nav>${state.submissions.length ? `<div class="dialog-foot"><button class="button" data-modal="history">Submissions (${state.submissions.length})</button></div>` : ''}`, 'questions');
  dialog.querySelector('[aria-current="step"]')?.scrollIntoView({ block: 'nearest' });
}

function questionItems() {
  return state.questionnaire.questions.map((q, index) => {
    const status = statusFor(state, q.id);
    const answered = hasAnswer(state.drafts[q.id]);
    const updated = isStale(state, q.id) && hasAnswer(state.drafts[q.id]);
    return `<button class="nav-item ${q.id === currentId ? 'active' : ''} ${status} " data-go="${escape(q.id)}" title="${escape(q.title)}" ${q.id === currentId ? 'aria-current="step"' : ''}><span class="nav-dot" aria-hidden="true">${status === 'submitted' ? '✓' : ''}</span><span class="nav-number">${String(index + 1).padStart(2, '0')}</span><span class="nav-text"><span class="nav-title">${escape(state.questionnaire.navigationLabels?.[q.id] || q.title)}</span><span class="nav-status">${answered ? 'Answered' : 'Not answered'}${updated ? ' · Updated' : ''}</span></span></button>`;
  }).join('');
}

function showKeys() {
  const shortcuts = [
    ['↓ / ↑', 'Focus the next / previous option or button'],
    ['← / →', 'Previous / next question'],
    ['j / k', 'Focus the next / previous option or button'],
    ['gg / G', 'Focus the first / last control'],
    ['Enter / Space', 'Activate the focused control'],
    ['h / l', 'Previous / next question'],
    ['1–9', 'Choose or toggle an option'],
    ['i', 'Write your answer or notes'],
    ['Esc', 'Leave the text field or close a dialog'],
    ['Ctrl / ⌘ + Enter', 'Submit the entire form, including while typing'],
    ['Ctrl + d / u', 'Scroll down / up half a page'],
    ['q', 'Open the question picker'],
    ['H', 'Open submission history'],
    ['b', 'Toggle the sidebar or open the question picker'],
    ['d', 'Answer later'],
    ['x', 'Clear this answer and its notes'],
    ['?', 'Open this guide'],
  ];
  openDialog(`${dialogHead('Keyboard shortcuts', 'Arrow keys and Vim-style navigation. Typing in the answer field uses your normal text editing keys.')}<div class="dialog-body"><p>Use <kbd>↓</kbd> / <kbd>↑</kbd> or <kbd>j</kbd> / <kbd>k</kbd> to reach every form action, including recovery and updated answers. Movement focuses options; <kbd>Enter</kbd> or <kbd>Space</kbd> selects them. In dialogs, navigation stays inside the dialog. Use <kbd>Tab</kbd> / <kbd>Shift + Tab</kbd> to reach text fields and other controls.</p><dl class="shortcut-list">${shortcuts.map(([keys, description]) => `<div><dt><kbd>${keys}</kbd></dt><dd>${description}</dd></div>`).join('')}</dl><label class="shortcut-setting"><input id="vim-enabled" type="checkbox" ${vimEnabled ? 'checked' : ''}> Enable Vim shortcuts</label><p class="field-hint">Arrow navigation, Tab, Enter, Space, Esc, and Ctrl / ⌘ + Enter also work with Vim shortcuts turned off.</p></div><div class="dialog-foot"><button class="button primary" data-modal="close">Back to form</button></div>`, 'keys');
}

const isEditing = element => element?.matches('textarea, select, input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"])') || element?.isContentEditable;

function updateKeyboardMode() {
  document.body.classList.toggle('vim-disabled', !vimEnabled);
  const mode = document.querySelector('#keyboard-mode');
  if (mode) mode.textContent = !vimEnabled ? 'Vim off' : isEditing(document.activeElement) ? 'Insert' : 'Normal';
}

function keyboardControls() {
  const selector = 'button:not(:disabled), input[type="radio"], input[type="checkbox"], summary, a[href], [tabindex="0"]';
  const controls = [...(dialog.open ? dialog : app).querySelectorAll(selector)].filter(element =>
    !element.disabled && element.getClientRects().length && (dialog.open || !element.closest('.sidebar')));
  // Start with dialog content; closing remains reachable at the end.
  return dialog.open ? [...controls.filter(el => !el.matches('.close')), ...controls.filter(el => el.matches('.close'))] : controls;
}

function focusControl(element) {
  element?.focus({ preventScroll: true });
  element?.scrollIntoView({ block: 'nearest' });
}

function runKeyboardCommand(command, value) {
  if (command === 'move' || command === 'edge') {
    const controls = keyboardControls(), index = controls.indexOf(document.activeElement);
    const next = command === 'edge' ? (value < 0 ? 0 : controls.length - 1)
      : index < 0 ? (value > 0 ? 0 : controls.length - 1) : Math.max(0, Math.min(controls.length - 1, index + value));
    return focusControl(controls[next]);
  }
  if (command === 'activate') {
    const element = document.activeElement;
    if (element?.matches('button:not(:disabled), input[type="radio"], input[type="checkbox"], summary, a[href]') && (!dialog.open || dialog.contains(element))) element.click();
    return;
  }
  if (command === 'scroll') {
    const focused = document.activeElement;
    const candidates = dialog.open ? [focused?.closest('.export-text, .question-list'), dialog] : [document.querySelector('.main')];
    const pane = candidates.find(element => element && element.scrollHeight > element.clientHeight);
    pane?.scrollBy({ top: value * pane.clientHeight / 2, behavior: 'instant' });
    return;
  }
  if (command === 'leave-edit') return focusControl(document.querySelector('#question-title'));
  if (command === 'close') return dialog.close();
  if (command === 'help') return showKeys();
  if (!state) return;
  if (command === 'navigate') {
    const questions = state.questionnaire.questions, index = questions.findIndex(q => q.id === currentId);
    if (questions[index + value]) navigate(questions[index + value].id);
  }
  if (command === 'choose') {
    const option = document.querySelectorAll('input[name="answer-option"]')[value];
    if (option) { focusControl(option); option.click(); }
  }
  if (command === 'edit') focusControl(document.querySelector('#answer-text'));
  if (command === 'submit') document.querySelector('#submit-form:not(:disabled)')?.click();
  if (command === 'questions') showQuestions();
  if (command === 'history') showHistory();
  if (command === 'sidebar') document.querySelector('#toggle-sidebar').click();
  if (command === 'clear' || command === 'defer') document.querySelector(`[data-action="${command}"]:not(:disabled)`)?.click();
}

const keyboard = createKeyboard({
  context: () => ({ enabled: vimEnabled, editing: isEditing(document.activeElement), modal: dialog.open }),
  run: runKeyboardCommand,
});
document.addEventListener('keydown', keyboard.keydown);
document.addEventListener('focusin', () => { keyboard.reset(); updateKeyboardMode(); });
document.addEventListener('focusout', () => queueMicrotask(updateKeyboardMode));
window.addEventListener('blur', keyboard.reset);
dialog.addEventListener('change', event => {
  if (event.target.id !== 'vim-enabled') return;
  vimEnabled = event.target.checked;
  try { localStorage.setItem('workbench-vim', vimEnabled ? 'on' : 'off'); } catch { /* The toggle still works for this tab. */ }
  updateKeyboardMode();
});

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

function submitForm() {
  if (conflict || pending.some(item => item.action.type === 'submit')) return;
  let snapshot;
  try {
    // Capture exactly what is in the form at explicit submission, including edits
    // still saving. The existing queue persists those edits before this snapshot.
    snapshot = makeSubmission(state, crypto.randomUUID(), new Date().toISOString());
  } catch (failure) {
    const changed = state.questionnaire.questions.find(q => hasAnswer(state.drafts[q.id]) && isStale(state, q.id));
    if (changed) navigate(changed.id);
    toast(failure.message);
    return;
  }
  shownSubmission = snapshot;
  openDialog(`${dialogHead('Submitting form')}<div class="dialog-body"><p role="status">Saving your whole form…</p></div>`, 'saving');
  stage({ type: 'submit', review: snapshot });
}

function renderSaveFailure() {
  openDialog(`${dialogHead('Your form is not saved yet')}<div class="dialog-body"><p>Your confirmed form is retained in this tab. ${escape(error)}</p><p>Keep this page open or download a recovery copy before leaving.</p><button class="button" data-modal="recover">Download recovery copy</button></div><div class="dialog-foot"><button class="button" data-modal="close">Back to form</button>${!conflict ? '<button class="button primary" data-modal="retry">Retry saving</button>' : ''}</div>`, 'save-failed');
}

function renderReceipt() {
  const status = document.querySelector('#delivery-status');
  if (status && shownSubmission) status.textContent = receivedIds.has(shownSubmission.id) ? 'Received by the agent in chat.' : 'Saved. Waiting for the agent to receive this form.';
}

async function refreshReceipt() {
  if (!state?.submissions.length) return;
  try {
    const receipts = await request('/api/delivery');
    receivedIds = new Set(receipts.received.map(r => r.submissionId));
    renderReceipt();
  } catch {
    const status = document.querySelector('#delivery-status');
    if (status) status.textContent = 'Your form is saved. Agent receipt could not be checked yet.';
  }
}

function showSubmission(submission) {
  shownSubmission = submission;
  openDialog(`${dialogHead('Form submitted', 'Your entire form is saved. You can continue in chat without copying or pasting anything.')}<div class="dialog-body"><div class="success-symbol" aria-hidden="true">✓</div><p id="delivery-status" role="status"></p><details class="submission-details"><summary id="submitted-form-details">View submitted form</summary><pre class="export-text" tabindex="0" aria-label="Submitted form text">${escape(formatSubmission(submission))}</pre></details></div><div class="dialog-foot"><button class="button primary" data-modal="close">Back to form</button></div>`, 'submission');
  render(); renderReceipt(); void refreshReceipt();
}

function showHistory() {
  const saved = state.submissions.filter(s => !pending.some(item => item.action.type === 'submit' && item.action.review.id === s.id));
  openDialog(`${dialogHead('Submitted answers', 'Earlier submissions keep their original questions and answers.')}<div class="dialog-body">${saved.map(s => `<button class="history-item" data-submission="${escape(s.id)}"><strong>Form · ${escape(new Date(s.createdAt).toLocaleString())}</strong><span>${s.answers.map(a => escape(a.question.title)).join('<br>')}</span></button>`).join('') || '<p>No saved submissions yet.</p>'}</div>`, 'history');
}

dialog.addEventListener('click', async event => {
  const go = event.target.closest('[data-go]');
  if (go) { dialogReturnFocus = { selector: '#question-title' }; dialog.close(); navigate(go.dataset.go); return; }
  const prior = event.target.closest('[data-submission]');
  if (prior) return showSubmission(state.submissions.find(s => s.id === prior.dataset.submission));
  const action = event.target.closest('[data-modal]')?.dataset.modal;
  if (action === 'close') dialog.close();
  if (action === 'history') showHistory();
  if (action === 'keys') showKeys();
  if (action === 'recover') downloadRecovery();
  if (action === 'retry') { modalMode = 'saving'; retry(); }

});
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  modalMode = '';
  if (!restoreFocus(dialogReturnFocus)) document.querySelector('#question-title')?.focus({ preventScroll: true });
  dialogReturnFocus = null;
  updateKeyboardMode();
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
  void refreshReceipt();
  if (running || pending.length || conflict || refreshing) return;
  refreshing = true;
  try {
    const result = await request('/api/session');
    // A poll begun before typing must never replace a newly staged answer.
    if (running || pending.length || conflict || result.version < version) return;
    connectionWarning = '';
    if (result.version !== version) {
      state = result.state; version = result.version;
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
