import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialState, restoreState, transition, validateQuestionnaire } from './core.js';
import { atomicWrite } from './storage.js';
import { readReceipts } from './delivery.js';
export { atomicWrite } from './storage.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicFiles = { '/': ['public/index.html', 'text/html'], '/app.js': ['public/app.js', 'text/javascript'], '/styles.css': ['public/styles.css', 'text/css'], '/core.js': ['src/core.js', 'text/javascript'] };

export function createWorkbenchServer({ dataDir = join(root, '.workbench'), questionsPath = join(root, 'data/questions.json'), write = atomicWrite } = {}) {
  const statePath = join(dataDir, 'session.json');
  let saved;
  let queue = Promise.resolve();
  const serial = fn => {
    const next = queue.then(fn);
    queue = next.catch(() => {});
    return next;
  };
  async function commit(next) {
    const previousIds = new Set(saved?.state.submissions.map(s => s.id));
    try { await write(statePath, `${JSON.stringify(next, null, 2)}\n`); }
    catch { throw new Error('The form could not be saved on this computer. Keep the page open and retry.'); }
    saved = next;
    for (const submission of saved.state.submissions) {
      if (!previousIds.has(submission.id)) server.emit('submission', structuredClone(submission));
    }
    return saved;
  }
  async function load() {
    let doc;
    try { doc = validateQuestionnaire(JSON.parse(await readFile(questionsPath, 'utf8'))); }
    catch { throw new Error('Question definitions could not be loaded. Ask the agent to check the question file, then retry. Saved answers have been kept.'); }
    if (!saved) {
      let raw;
      try { raw = JSON.parse(await readFile(statePath, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new Error('Saved work could not be read. The file has been kept; restore a valid backup to continue.'); }
      if (raw) {
        if (!Number.isSafeInteger(raw.version) || raw.version < 1 || !Array.isArray(raw.operations) || !raw.operations.every(id => typeof id === 'string')) throw new Error('Saved work has an unsupported format. The file has been kept.');
        saved = { version: raw.version, operations: raw.operations, state: restoreState(raw.state) };
      } else await commit({ version: 1, operations: [], state: initialState(doc) });
    }
    const state = transition(saved.state, { type: 'definitions', questionnaire: doc });
    if (state !== saved.state) await commit({ ...saved, version: saved.version + 1, state });
    return saved;
  }
  const envelope = value => ({ version: value.version, state: value.state });
  function respond(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  async function readBody(req) {
    if (req.headers['content-type'] !== 'application/json') throw Object.assign(new Error('JSON is required.'), { status: 415 });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 2_000_000) throw Object.assign(new Error('This update is too large.'), { status: 413 });
    }
    try { return JSON.parse(body); } catch { throw Object.assign(new Error('Invalid JSON.'), { status: 400 }); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (req.headers.origin && req.headers.origin !== `http://${host}`)) return respond(res, 403, { error: 'This workbench accepts requests from its own local page only.' });
    const path = new URL(req.url, `http://${host}`).pathname;
    try {
      if (path === '/api/health' && req.method === 'GET') {
        await serial(load);
        return respond(res, 200, { status: 'ok', instanceId: server.instanceId ?? null });
      }
      if (path === '/api/delivery' && req.method === 'GET') return respond(res, 200, await readReceipts(dataDir));
      if (path === '/api/session' && req.method === 'GET') return respond(res, 200, envelope(await serial(load)));
      if (path === '/api/actions' && req.method === 'POST') {
        const input = await readBody(req);
        const result = await serial(async () => {
          await load();
          if (!input || typeof input.requestId !== 'string' || input.requestId.length > 100 || !input.requestId.length) throw Object.assign(new Error('A request ID is required.'), { status: 400 });
          if (saved.operations.includes(input.requestId)) return envelope(saved);
          // A lost submission response can be retried even after another save.
          if (input.action?.type === 'submit' && saved.state.submissions.some(s => s.id === input.action.review?.id)) {
            transition(saved.state, input.action);
            return envelope(saved);
          }
          if (input.version !== saved.version) throw Object.assign(new Error('The saved form changed in another tab or the questions were updated. Your unsaved work is still available here.'), { status: 409, current: envelope(saved) });
          if (!['edit', 'defer', 'adopt', 'submit'].includes(input.action?.type)) throw Object.assign(new Error('Unsupported form action.'), { status: 400 });
          let state;
          try { state = transition(saved.state, input.action); }
          catch (error) { throw Object.assign(error, { status: 422 }); }
          return envelope(await commit({ version: saved.version + 1, operations: [...saved.operations, input.requestId].slice(-100), state }));
        });
        return respond(res, 200, result);
      }
      if (req.method === 'GET' && publicFiles[path]) {
        const [file, type] = publicFiles[path];
        const body = await readFile(join(root, file));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      respond(res, 404, { error: 'Not found.' });
    } catch (error) {
      respond(res, error.status || 500, { error: error.status ? error.message : `Could not load or save the form. ${error.message}`, ...(error.current ? { current: error.current } : {}) });
    }
  });
  server.prepare = () => serial(load);
  server.drain = () => queue;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { startWorkbench, handleShutdown } = await import('./runtime.js');
  try {
    const running = await startWorkbench({ dataDir: join(root, '.workbench'), questionsPath: join(root, 'data/questions.json'), port: Number(process.env.PORT || 4310), signalPort: Number(process.env.SIGNAL_PORT || 4311) });
    handleShutdown(running);
    console.log(`Workbench: ${running.info.url}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
