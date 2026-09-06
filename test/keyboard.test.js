import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboard } from '../public/keyboard.js';

function setup() {
  const mode = { enabled: true, editing: false, modal: false }, commands = [];
  let time = 0;
  const keyboard = createKeyboard({ context: () => mode, run: (...args) => commands.push(args), now: () => time });
  const press = (key, options = {}) => {
    const event = { key, ...options, preventDefault() { this.defaultPrevented = true; } };
    keyboard.keydown(event);
    return Boolean(event.defaultPrevented);
  };
  return { mode, commands, press, reset: keyboard.reset, advance: ms => { time += ms; } };
}

test('a keyboard-only answer workflow distinguishes movement, editing and explicit submission', () => {
  const { mode, commands, press } = setup();
  press('j'); press('j'); press('Enter'); press('i');
  mode.editing = true;
  for (const key of 'hjklxdiq?123G') assert.equal(press(key), false);
  assert.equal(press('Enter'), false, 'plain Enter must still insert a newline');
  press('Escape'); mode.editing = false;
  press('l'); press('2'); press('i'); mode.editing = true;
  press('Enter', { ctrlKey: true });
  assert.deepEqual(commands, [
    ['move', 1], ['move', 1], ['activate', undefined], ['edit', undefined],
    ['leave-edit', undefined], ['navigate', 1], ['choose', 1], ['edit', undefined], ['submit', undefined],
  ]);
});

test('dialogs permit local navigation but never change or submit the form underneath', () => {
  const { mode, commands, press } = setup();
  mode.modal = true;
  for (const key of ['h', 'l', 'i', '1', 'q', 'H', 'b', 'd', 'x', '?']) assert.equal(press(key), false);
  assert.equal(press('Enter', { ctrlKey: true }), false);
  assert.equal(press('Enter', { metaKey: true }), false);
  press('j'); press('k'); press('g'); press('g'); press('G'); press('Enter'); press('Escape');
  assert.deepEqual(commands, [['move', 1], ['move', -1], ['edge', -1], ['edge', 1], ['activate', undefined], ['close', undefined]]);
});

test('gg requires two deliberate consecutive presses within one second and resets on focus changes', () => {
  const { commands, press, advance, reset } = setup();
  press('g'); advance(1000); press('g');
  assert.deepEqual(commands, []);
  press('g');
  assert.deepEqual(commands, [['edge', -1]]);
  press('g'); press('Tab'); press('g'); reset(); press('g');
  assert.equal(commands.length, 1);
  press('g', { repeat: true });
  assert.equal(commands.length, 1, 'holding g is not gg');
});

test('held keys navigate without repeated selection, clearing or submission', () => {
  const { commands, press } = setup();
  for (const key of ['1', 'x', 'd', 'Enter', '?', 'H', 'q', 'i', 'b', 'G']) press(key, { repeat: true });
  press('Enter', { ctrlKey: true, repeat: true });
  assert.deepEqual(commands, []);
  press('j', { repeat: true }); press('h', { repeat: true }); press('d', { ctrlKey: true, repeat: true });
  assert.deepEqual(commands, [['move', 1], ['navigate', -1], ['scroll', 1]]);
});

test('composition, browser shortcuts, selection keys and disabled Vim pass through', () => {
  const { commands, press, mode } = setup();
  for (const options of [{ isComposing: true }, { keyCode: 229 }, { altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
    assert.equal(press('j', options), false);
  }
  press('j', { defaultPrevented: true });
  assert.equal(press('Enter', { ctrlKey: true, shiftKey: true }), false);
  for (const key of ['Tab', 'ArrowDown', 'ArrowLeft', ' ', 'Home', 'End']) assert.equal(press(key), false);
  assert.equal(press('f', { ctrlKey: true }), false);
  mode.editing = true;
  assert.equal(press('u', { ctrlKey: true }), false);
  mode.enabled = false;
  for (const key of ['j', 'x', '?', 'Escape']) assert.equal(press(key), false);
  assert.equal(press('Enter', { metaKey: true }), false);
  assert.deepEqual(commands, []);
});

test('navigation, scroll and form actions have distinct mappings', () => {
  const { commands, press } = setup();
  for (const key of ['h', 'l', '1', '9', 'q', 'H', 'b', 'd', 'x', '?']) press(key);
  press('d', { ctrlKey: true }); press('u', { ctrlKey: true }); press('Enter', { metaKey: true });
  assert.deepEqual(commands, [
    ['navigate', -1], ['navigate', 1], ['choose', 0], ['choose', 8],
    ['questions', undefined], ['history', undefined], ['sidebar', undefined],
    ['defer', undefined], ['clear', undefined], ['help', undefined],
    ['scroll', 1], ['scroll', -1], ['submit', undefined],
  ]);
});
