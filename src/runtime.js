import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWorkbenchServer } from './server.js';
import { createSubmissionSocket } from './submission-socket.js';
import { acquireLock, atomicWrite } from './storage.js';

export function validPort(value) {
  if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Ports must be integers from 0 to 65535 (0 chooses a free port).');
  return value;
}

export async function readRuntime(dataDir) {
  let info;
  try { info = JSON.parse(await readFile(join(dataDir, 'runtime.json'), 'utf8')); }
  catch { throw new Error('No readable running-session descriptor. Start serve for this session first.'); }
  if (info.protocolVersion !== 1 || info.dataDir !== resolve(dataDir) || typeof info.instanceId !== 'string' || typeof info.token !== 'string' || !/^[a-f0-9]{64}$/.test(info.token)
    || !Number.isInteger(info.signalPort) || info.signalPort < 1 || info.signalPort > 65535
    || !Number.isInteger(info.port) || info.port < 1 || info.port > 65535
    || info.url !== `http://127.0.0.1:${info.port}/`) throw new Error('Invalid running-session descriptor. Restart this session.');
  return info;
}

export async function startWorkbench({ dataDir, questionsPath, port = 0, signalPort = 0 }) {
  validPort(port); validPort(signalPort);
  dataDir = resolve(dataDir);
  const release = await acquireLock(join(dataDir, 'server.lock'));
  const server = createWorkbenchServer({ dataDir, questionsPath });
  server.instanceId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const signals = createSubmissionSocket(server, { dataDir, token });
  let closing;
  const close = () => closing ||= (async () => {
    signals.closeClients();
    if (signals.listening) await new Promise(resolve => signals.close(resolve));
    if (server.listening) await new Promise(resolve => server.close(resolve));
    await server.drain();
    await rm(join(dataDir, 'runtime.json'), { force: true });
    await release();
  })();
  try {
    await server.prepare();
    signals.listen(signalPort, '127.0.0.1'); await once(signals, 'listening');
    server.listen(port, '127.0.0.1'); await once(server, 'listening');
    const info = { protocolVersion: 1, instanceId: server.instanceId, pid: process.pid, dataDir, port: server.address().port, signalPort: signals.address().port, url: `http://127.0.0.1:${server.address().port}/`, token };
    await atomicWrite(join(dataDir, 'runtime.json'), `${JSON.stringify(info, null, 2)}\n`);
    return { server, signals, info, close };
  } catch (error) { await close(); throw error; }
}

export function handleShutdown(running) {
  const shutdown = () => { void running.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  for (const server of [running.server, running.signals]) server.on('error', error => {
    console.error(error.message); process.exitCode = 1; shutdown();
  });
}
