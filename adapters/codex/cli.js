import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DesktopConnection } from './desktop.js';
import { listen } from './listen.js';

const help = `Optional Codex desktop adapter for Grilling Workbench

  check [--thread ID] [--socket PATH]   Verify the exact task's desktop connection
  listen --session DIR [--thread ID] [--socket PATH]
                                      Deliver one saved form as a tool result
  --version | --help

Thread defaults to CODEX_THREAD_ID, never to another task by recency.
After the listening status, leave the process running and return control to chat.
No polling, scheduled monitor, model API key, or automatic acknowledgment.
This adapter uses internal desktop IPC; incompatible hosts fail explicitly.`;

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    session: { type: 'string' }, thread: { type: 'string' }, socket: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (values.help || !args.length) return console.log(help);
  if (values.version) return console.log(JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8')).version);
  const [command] = positionals;
  if (positionals.length !== 1 || !['check', 'listen'].includes(command)) throw new Error(help);
  if (command === 'check' && values.session) throw new Error('check does not take --session.');
  if (command === 'listen' && !values.session) throw new Error('--session DIR is required.');
  const options = { threadId: values.thread ?? process.env.CODEX_THREAD_ID,
    ...(values.socket ? { socketPath: resolve(values.socket) } : {}) };
  if (command === 'check') {
    const desktop = new DesktopConnection(options);
    try {
      await desktop.connect();
      console.log(JSON.stringify({ status: 'compatible', threadId: options.threadId, state: desktop.state }));
    } finally { desktop.close(); }
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Adapter stopped; unacknowledged submissions remain saved.'));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await listen({ ...options, session: resolve(values.session), signal: controller.signal,
      onStatus: value => console.log(JSON.stringify(value)) });
  } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
}
