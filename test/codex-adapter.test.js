import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkbench } from '../src/runtime.js';
import { makeReview } from '../src/core.js';
import { pendingSubmissions, readReceipts, acknowledgeSubmission } from '../src/delivery.js';
import { listen } from '../adapters/codex/listen.js';
import { DesktopConnection } from '../adapters/codex/desktop.js';
import { mockDesktop } from './helpers/mock-desktop.js';

async function setup(t, desktopOptions) {
  const directory = await mkdtemp(join(tmpdir(), 'wb-codex-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = join(directory, 'round'); await mkdir(session);
  await writeFile(join(session, 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  await writeFile(join(session, 'questions.json'), await readFile(new URL('../data/questions.json', import.meta.url)));
  const workbench = await startWorkbench({ dataDir: session, questionsPath: join(session, 'questions.json') });
  t.after(workbench.close);
  const desktop = await mockDesktop(directory, desktopOptions); t.after(desktop.close);
  const options = { session, threadId: 'exact-thread', socketPath: desktop.socketPath, timeoutMs: 1000 };
  const post = async action => {
    const current = await (await fetch(`${workbench.info.url}api/session`)).json();
    const response = await fetch(`${workbench.info.url}api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: current.version, requestId: crypto.randomUUID(), action }) });
    assert.equal(response.status, 200); return response.json();
  };
  const submit = async () => {
    const current = await (await fetch(`${workbench.info.url}api/session`)).json();
    const submission = makeReview(current.state, crypto.randomUUID(), new Date().toISOString());
    await post({ type: 'submit', review: submission }); return submission;
  };
  const arm = () => {
    const controller = new AbortController();
    let ready;
    const listening = new Promise(resolve => { ready = resolve; });
    const done = listen({ ...options, signal: controller.signal, onStatus: value => { if (value.status === 'listening') ready(); } });
    done.catch(() => {});
    t.after(() => controller.abort());
    return { done, listening, controller };
  };
  return { session, desktop, options, post, submit, arm };
}

test('adapter delivers the durable full form to the exact active task without acknowledging', { timeout: 5000 }, async t => {
  const api = await setup(t);
  const run = api.arm(); await run.listening;
  const discoveryCount = api.desktop.requests.length;
  await api.post({ type: 'edit', questionId: 'atmosphere', answer: { optionIds: ['quiet'], text: 'Clarification stays in chat' } });
  assert.equal(api.desktop.deliveries.length, 0, 'Drafts are never delivered');
  assert.equal(api.desktop.requests.length, discoveryCount, 'No status polling while answering');
  await assert.rejects(listen(api.options), /locked/);
  const submission = await api.submit();
  const result = await run.done;
  assert.equal(result.submissionId, submission.id);
  const [delivery] = api.desktop.deliveries;
  assert.equal(delivery.method, 'thread-follower-steer-turn');
  assert.equal(delivery.targetClientId, 'test-desktop-owner');
  assert.equal(delivery.params.conversationId, 'exact-thread');
  assert.deepEqual(delivery.params.input, []);
  assert.deepEqual(JSON.parse(delivery.params.toolOutput.output), { session: api.session, submission });
  assert.deepEqual(submission.answers.map(answer => answer.outcome), ['answered', 'not_answered', 'not_answered']);
  assert.deepEqual((await readReceipts(api.session)).received, []);
  assert.equal((await pendingSubmissions(api.session)).length, 1);
  await assert.rejects(readFile(join(api.session, 'codex-adapter.lock')), { code: 'ENOENT' });
  const status = await readFile(join(api.session, 'codex-adapter-status.json'), 'utf8');
  await assert.rejects(listen({ ...api.options, threadId: 'different-task' }), /different Codex task/);
  assert.equal(await readFile(join(api.session, 'codex-adapter-status.json'), 'utf8'), status);
  await acknowledgeSubmission(submission.id, { dataDir: api.session });
  const next = api.arm(); await next.listening; next.controller.abort();
  await assert.rejects(next.done, /aborted/);
  assert.equal(api.desktop.deliveries.length, 1, 'Acknowledged submissions do not replay');
});

test('saved submissions replay into an idle task and preserve its settings', { timeout: 5000 }, async t => {
  const api = await setup(t, { state: 'idle' });
  const submission = await api.submit();
  await listen(api.options);
  const delivery = api.desktop.deliveries[0];
  assert.equal(delivery.method, 'thread-follower-start-turn');
  assert.deepEqual(delivery.params.turnStart.context, { inheritThreadSettings: true });
  const request = delivery.params.turnStart.request;
  assert.deepEqual(Object.keys(request).sort(), ['input', 'threadId', 'toolOutput']);
  assert.deepEqual(JSON.parse(request.toolOutput.output).submission, submission);
  await listen(api.options);
  assert.equal(api.desktop.deliveries.length, 2, 'Unacknowledged submission replays after explicit restart');
});

test('a confirmed active-to-idle race retries only the idle delivery route', { timeout: 5000 }, async t => {
  const api = await setup(t, { rejectDelivery: request => request.method === 'thread-follower-steer-turn' ? 'NoActiveTurn' : null });
  await api.submit(); await listen(api.options);
  assert.deepEqual(api.desktop.deliveries.map(d => d.method), ['thread-follower-steer-turn', 'thread-follower-start-turn']);
});

test('an uncertain delivery is never retried automatically and its submission remains pending', { timeout: 5000 }, async t => {
  const api = await setup(t, { silentDelivery: true });
  await api.submit();
  await assert.rejects(listen({ ...api.options, timeoutMs: 100 }), /timed out/);
  assert.equal(api.desktop.deliveries.length, 1);
  assert.equal((await pendingSubmissions(api.session)).length, 1);
  assert.equal(JSON.parse(await readFile(join(api.session, 'codex-adapter-status.json'))).status, 'failed');
});

test('explicit host failure retains the snapshot and never falls back to chat text', { timeout: 5000 }, async t => {
  const api = await setup(t, { state: 'idle', rejectDelivery: () => 'Unsupported toolOutput' });
  await api.submit(); await assert.rejects(listen(api.options), /Unsupported toolOutput/);
  assert.equal(api.desktop.deliveries.length, 1);
  assert.deepEqual((await readReceipts(api.session)).received, []);
});

test('desktop disconnection aborts the socket listener and releases its lock', { timeout: 5000 }, async t => {
  const api = await setup(t);
  const run = api.arm(); await run.listening; api.desktop.disconnect();
  await assert.rejects(run.done, /disconnected/);
  await assert.rejects(readFile(join(api.session, 'codex-adapter.lock')), { code: 'ENOENT' });
  await api.submit(); await listen(api.options);
  assert.equal(api.desktop.deliveries.length, 1, 'Recovery reconnects and delivers the saved form');
});

test('incompatible desktop state fails before listening or delivering', { timeout: 5000 }, async t => {
  const api = await setup(t, { version: 99 });
  await assert.rejects(listen(api.options), /Unsupported Codex task-state protocol/);
  assert.equal(api.desktop.deliveries.length, 0);
});

test('foreign task events cannot change delivery routing; invalid framing closes the connection', { timeout: 5000 }, async t => {
  const api = await setup(t);
  const connection = new DesktopConnection(api.options);
  t.after(() => connection.close());
  await connection.connect();
  connection.handle({ type: 'broadcast', sourceClientId: 'test-desktop-owner', version: 11, method: 'thread-stream-state-changed',
    params: { hostId: 'local', conversationId: 'foreign-task', change: { type: 'snapshot', revision: 2, conversationState: { threadRuntimeStatus: { type: 'idle' } } } } });
  assert.equal(connection.state, 'active');
  const lost = new Promise(resolve => connection.once('disconnect', resolve));
  connection.read(Buffer.alloc(4));
  assert.match((await lost).message, /frame length/);
  await assert.rejects(connection.deliver({}), /frame length/);
});
