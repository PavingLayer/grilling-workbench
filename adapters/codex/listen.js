import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireLock, atomicWrite } from '../../src/storage.js';
import { readRuntime } from '../../src/runtime.js';
import { waitForSubmission } from '../../src/submission-socket.js';
import { DesktopConnection } from './desktop.js';

// One delivery per invocation. The agent, never this adapter, writes the receipt.
export async function listen({ session, threadId, socketPath, signal, onStatus = () => {}, timeoutMs }) {
  const dataDir = await realpath(session);
  const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8'));
  if (config.schemaVersion !== 1) throw new Error('Unsupported workbench session configuration.');
  const desktop = new DesktopConnection({ socketPath, threadId, timeoutMs });
  const release = await acquireLock(join(dataDir, 'codex-adapter.lock'));
  const controller = new AbortController();
  const abort = () => { controller.abort(signal.reason); desktop.close(); };
  const disconnected = error => controller.abort(error);
  const status = async (state, extra = {}) => {
    const value = { status: state, session: dataDir, threadId, pid: process.pid, updatedAt: new Date().toISOString(), ...extra };
    await atomicWrite(join(dataDir, 'codex-adapter-status.json'), `${JSON.stringify(value, null, 2)}\n`);
    onStatus(value);
  };
  signal?.addEventListener('abort', abort, { once: true });
  desktop.on('disconnect', disconnected);
  let ownsBinding = false;
  try {
    signal?.throwIfAborted();
    const bindingPath = join(dataDir, 'codex-adapter.json');
    let binding;
    try { binding = JSON.parse(await readFile(bindingPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (binding && (binding.schemaVersion !== 1 || binding.threadId !== threadId)) {
      throw new Error('This workbench round is already bound to a different Codex task. Use its original task or a new session.');
    }
    ownsBinding = true;
    const runtime = await readRuntime(dataDir);
    await desktop.connect();
    controller.signal.throwIfAborted();
    if (!binding) await atomicWrite(bindingPath, `${JSON.stringify({ schemaVersion: 1, threadId }, null, 2)}\n`);
    let readyWrite = Promise.resolve();
    const submission = await waitForSubmission({ port: runtime.signalPort, token: runtime.token, signal: controller.signal,
      onReady: () => { readyWrite = status('listening').catch(error => { controller.abort(error); throw error; }); readyWrite.catch(() => {}); } });
    await readyWrite;
    controller.signal.throwIfAborted();
    const delivered = await desktop.deliver({ session: dataDir, submission });
    await status('delivered', { submissionId: submission.id, ...delivered });
    return { session: dataDir, submissionId: submission.id, ...delivered };
  } catch (error) {
    const failure = controller.signal.reason instanceof Error ? controller.signal.reason : error;
    if (ownsBinding) await status(signal?.aborted ? 'stopped' : 'failed', { error: failure.message }).catch(() => {});
    throw failure;
  } finally {
    signal?.removeEventListener('abort', abort);
    desktop.off('disconnect', disconnected);
    controller.abort(); desktop.close(); await release();
  }
}
