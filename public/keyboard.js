// Keep command interpretation separate from DOM focus and form mutations.
export function createKeyboard({ context, run, now = Date.now }) {
  let firstG = null;
  const reset = () => { firstG = null; };
  function keydown(event) {
    const { enabled, editing, modal } = context();
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || !enabled) return reset();
    const key = event.key;
    let command, value;
    if (event.ctrlKey || event.metaKey) {
      reset();
      if (key === 'Enter' && !event.shiftKey && !modal) command = 'submit';
      else if (event.ctrlKey && !event.metaKey && !event.shiftKey && !editing && ['d', 'u'].includes(key)) {
        command = 'scroll'; value = key === 'd' ? 1 : -1;
      } else return;
    } else if (editing) {
      reset();
      if (key !== 'Escape') return;
      command = 'leave-edit';
    } else {
      const previousG = firstG;
      reset();
      if (key === 'g') {
        if (event.repeat) { event.preventDefault(); return; }
        if (previousG !== null && now() - previousG < 1000) { command = 'edge'; value = -1; }
        else { firstG = now(); event.preventDefault(); return; }
      } else if (key === 'G') { command = 'edge'; value = 1; }
      else if (key === 'j' || key === 'k') { command = 'move'; value = key === 'j' ? 1 : -1; }
      else if (key === 'Enter') command = 'activate';
      else if (key === 'Escape') command = modal ? 'close' : 'leave-edit';
      else if (!modal) {
        if (key === 'h' || key === 'l') { command = 'navigate'; value = key === 'l' ? 1 : -1; }
        else if (/^[1-9]$/.test(key)) { command = 'choose'; value = Number(key) - 1; }
        else command = { i: 'edit', q: 'questions', H: 'history', b: 'sidebar', d: 'defer', x: 'clear', '?': 'help' }[key];
      }
    }
    if (!command) return;
    event.preventDefault();
    // Holding a key may move the cursor, but must not toggle, clear or submit twice.
    if (event.repeat && !['move', 'navigate', 'scroll'].includes(command)) return;
    run(command, value);
  }
  return { keydown, reset };
}
