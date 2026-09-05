import { parseArgs } from 'node:util';
import { readFile, readdir, mkdir, cp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestionnaire } from './core.js';
import { atomicWrite } from './storage.js';
import { readRuntime, startWorkbench, handleShutdown, validPort } from './runtime.js';
import { pendingSubmissions, acknowledgeSubmission } from './delivery.js';
import { waitForSubmission } from './submission-socket.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = value => console.log(JSON.stringify(value, null, 2));
const help = `Grilling Workbench — local forms with event-driven agent delivery

  init --session DIR --questions FILE   Create an isolated round (never overwrites)
  init --session DIR --demo             Create a reading-room demonstration
  validate --questions FILE            Check question definitions
  update --session DIR --questions FILE Atomically refresh the same round
  serve --session DIR [--port N] [--signal-port N]
                                       Start both loopback listeners; 0 = free port
  wait --session DIR                   Block on TCP until a saved form arrives
  pending --session DIR                Inspect unacknowledged forms once
  ack SUBMISSION_ID --session DIR       Record receipt after reading in chat
  status --session DIR                 Check the running session once
  install-skill [--target DIR]          Install the bundled skill without overwriting
  --version | --help

Keep serve and wait running in separate process sessions. Wait never acknowledges
automatically. Session paths are relative to the working directory. Stop serve
with Ctrl+C or SIGTERM. No public listener, model API, or polling monitor.`;

async function readQuestions(path) {
  if (!path) throw new Error('--questions FILE is required.');
  const text = await readFile(resolve(path), 'utf8');
  if (Buffer.byteLength(text) > 1_000_000) throw new Error('Question definitions must be at most 1 MB. Split large interviews into rounds.');
  return validateQuestionnaire(JSON.parse(text));
}

async function sessionPath(value) {
  if (!value) throw new Error('--session DIR is required; use the exact directory assigned to this chat round.');
  return resolve(value);
}

async function requireSession(value) {
  const dir = await sessionPath(value);
  let config;
  try { config = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')); }
  catch { throw new Error(`No initialized session at ${dir}. Use init with a new directory; never replace saved answers.`); }
  if (config.schemaVersion !== 1) throw new Error('Unsupported session configuration.');
  return dir;
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    session: { type: 'string' }, questions: { type: 'string' }, demo: { type: 'boolean' },
    port: { type: 'string' }, 'signal-port': { type: 'string' }, target: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (values.help || !args.length) return console.log(help);
  if (values.version) return console.log(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version);
  const [command, id] = positionals;
  const allowed = { init: ['session', 'questions', 'demo'], validate: ['questions'], update: ['session', 'questions'], serve: ['session', 'port', 'signal-port'], wait: ['session'], pending: ['session'], ack: ['session'], status: ['session'], 'install-skill': ['target'] };
  if (!allowed[command]) throw new Error(`Unknown command.\n${help}`);
  if (positionals.length !== (command === 'ack' ? 2 : 1)) throw new Error('Unexpected or missing command arguments. Use --help.');
  for (const key of Object.keys(values)) if (!allowed[command].includes(key)) throw new Error(`--${key} is not supported by ${command}.`);
  if (command === 'validate') {
    const doc = await readQuestions(values.questions);
    return output({ valid: true, questionnaireId: doc.id, questions: doc.questions.length });
  }
  if (command === 'install-skill') {
    const target = resolve(values.target || '.agents/skills/grilling-workbench');
    await mkdir(dirname(target), { recursive: true });
    await mkdir(target); // Refuse existing skills, including symlinks.
    try {
      const source = join(root, 'skills/grilling-workbench');
      for (const entry of await readdir(source)) await cp(join(source, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true });
    }
    catch (error) { await rm(target, { recursive: true, force: true }); throw error; }
    return output({ installed: target, next: 'In Codex, invoke $grilling-workbench to verify discovery; restart Codex if it does not appear. Other agent applications may require reloading their skill list.' });
  }
  if (command === 'init') {
    if (Boolean(values.demo) === Boolean(values.questions)) throw new Error('Choose either --questions FILE or --demo.');
    const dir = await sessionPath(values.session);
    const doc = await readQuestions(values.demo ? join(root, 'data/questions.json') : values.questions);
    await mkdir(dirname(dir), { recursive: true, mode: 0o700 });
    await mkdir(dir, { mode: 0o700 });
    try {
      await atomicWrite(join(dir, '.gitignore'), '*\n');
      await atomicWrite(join(dir, 'questions.json'), `${JSON.stringify(doc, null, 2)}\n`);
      await atomicWrite(join(dir, 'config.json'), `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString() }, null, 2)}\n`);
    } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
    return output({ session: dir, questions: join(dir, 'questions.json'), questionnaireId: doc.id });
  }
  const dir = await requireSession(values.session);
  if (command === 'update') {
    const doc = await readQuestions(values.questions);
    const previous = await readQuestions(join(dir, 'questions.json'));
    if (doc.id !== previous.id) throw new Error('Keep the questionnaire ID for this round; initialize a new session for another round.');
    await atomicWrite(join(dir, 'questions.json'), `${JSON.stringify(doc, null, 2)}\n`);
    return output({ updated: join(dir, 'questions.json'), questions: doc.questions.length });
  }
  if (command === 'pending') return output({ submissions: await pendingSubmissions(dir) });
  if (command === 'ack') return output(await acknowledgeSubmission(id, { dataDir: dir }));
  if (command === 'serve') {
    const running = await startWorkbench({ dataDir: dir, questionsPath: join(dir, 'questions.json'), port: validPort(Number(values.port ?? 0)), signalPort: validPort(Number(values['signal-port'] ?? 0)) });
    handleShutdown(running);
    return output({ status: 'ready', session: dir, url: running.info.url, signalPort: running.info.signalPort });
  }
  const runtime = await readRuntime(dir);
  if (command === 'status') {
    const response = await fetch(`${runtime.url}api/health`, { signal: AbortSignal.timeout(3000) });
    const health = await response.json();
    if (!response.ok || health.instanceId !== runtime.instanceId) throw new Error('This session is unavailable or has a stale runtime descriptor. Restart its server.');
    return output({ status: 'ready', session: dir, url: runtime.url, pending: (await pendingSubmissions(dir)).length });
  }
  const submission = await waitForSubmission({ port: runtime.signalPort, token: runtime.token, onReady: () => console.error(`Listening for a saved form over TCP: ${dir}. No polling.`) });
  output({ session: dir, submission });
}
