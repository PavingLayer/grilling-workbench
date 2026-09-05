import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorkbench, readRuntime } from '../src/runtime.js';
import { waitForSubmission } from '../src/submission-socket.js';
import { makeReview } from '../src/core.js';

async function fixture(t) {
  const dataDir = await mkdtemp(join(tmpdir(), 'workbench-runtime-'));
  const questionsPath = join(dataDir, 'questions.json');
  await writeFile(questionsPath, await readFile(new URL('../data/questions.json', import.meta.url)));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  return { dataDir, questionsPath };
}

test('runtime owns one session, verifies listener identity, and releases ports and locks', { timeout: 5000 }, async t => {
  const options = await fixture(t);
  const running = await startWorkbench(options);
  t.after(running.close);
  const info = await readRuntime(options.dataDir);
  assert.deepEqual(info, running.info);
  assert.equal((await fetch(`${info.url}api/health`)).status, 200);
  await assert.rejects(startWorkbench(options), /locked/);
  await assert.rejects(waitForSubmission({ port: info.signalPort, token: 'wrong' }), /Wrong session/);
  const envelope = await (await fetch(`${info.url}api/session`)).json();
  const review = makeReview(envelope.state, 'runtime-form', '2026-09-05T00:00:00Z');
  const received = waitForSubmission({ port: info.signalPort, token: info.token });
  await fetch(`${info.url}api/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: envelope.version, requestId: 'runtime-submit', action: { type: 'submit', review } }) });
  assert.deepEqual(await received, review);
  await running.close();
  await assert.rejects(readRuntime(options.dataDir), /Start serve/);
  const restarted = await startWorkbench({ ...options, port: info.port, signalPort: info.signalPort });
  try {
    assert.deepEqual(await waitForSubmission({ port: restarted.info.signalPort, token: restarted.info.token }), review);
    await assert.rejects(waitForSubmission({ port: restarted.info.signalPort, token: info.token }), /Wrong session/);
  } finally { await restarted.close(); }
});

test('startup failures preserve state, close the other listener, and release the session', async t => {
  const options = await fixture(t);
  await writeFile(join(options.dataDir, 'session.json'), '{broken');
  await assert.rejects(startWorkbench(options), /kept/);
  assert.equal(await readFile(join(options.dataDir, 'session.json'), 'utf8'), '{broken');
  await assert.rejects(readFile(join(options.dataDir, 'server.lock')), { code: 'ENOENT' });
  await rm(join(options.dataDir, 'session.json'));
  const running = await startWorkbench(options);
  t.after(running.close);
  const other = await fixture(t);
  await assert.rejects(startWorkbench({ ...other, port: running.info.port }), { code: 'EADDRINUSE' });
  const recovered = await startWorkbench(other);
  await recovered.close();
});
