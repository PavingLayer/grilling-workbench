import net from 'node:net';
import { EventEmitter, once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

// Internal desktop protocol, isolated from the workbench's form/event contract.
// Verified with the desktop's bundled Codex 0.153.0-alpha.5 on Linux.
const MAX_FRAME = 256 * 1024 * 1024;
export const defaultSocketPath = () => join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'ipc/ipc.sock');

export class DesktopConnection extends EventEmitter {
  constructor({ socketPath = defaultSocketPath(), threadId, cwd = process.cwd(), timeoutMs = 10000 }) {
    super();
    if (typeof threadId !== 'string' || !threadId.trim()) throw new Error('An exact Codex thread ID is required (--thread or CODEX_THREAD_ID).');
    Object.assign(this, { socketPath, threadId, cwd, timeoutMs });
    this.clientId = 'initializing-client';
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.state = null;
    this.revision = null;
    this.failure = null;
  }

  async connect() {
    if (process.platform === 'win32') throw new Error('This Codex desktop IPC adapter currently supports local Unix sockets only.');
    const [socketInfo, parent] = await Promise.all([lstat(this.socketPath), lstat(dirname(this.socketPath))]);
    if (!socketInfo.isSocket() || !parent.isDirectory() || socketInfo.uid !== process.getuid()
        || parent.uid !== process.getuid() || (parent.mode & 0o022) || (socketInfo.mode & 0o022)) {
      throw new Error('The desktop socket and its directory must be owned by this user and not writable by others.');
    }
    this.socket = net.createConnection(this.socketPath);
    this.socket.on('data', chunk => this.read(chunk));
    this.socket.on('error', error => this.fail(error));
    this.socket.on('close', () => this.fail(new Error('Codex desktop disconnected. Restart the adapter after reopening this task.')));
    await once(this.socket, 'connect', { signal: AbortSignal.timeout(this.timeoutMs) });
    const init = await this.request('initialize', { clientType: 'grilling-workbench-adapter' }, 0);
    if (typeof init.result?.clientId !== 'string') throw new Error('Unsupported desktop initialization response.');
    this.clientId = init.result.clientId;
    const owner = await this.request('thread-owner-discovery', { hostId: 'local', conversationId: this.threadId }, 1);
    if (typeof owner.handledByClientId !== 'string' || owner.result?.supportsUntrustedAppInput !== true) {
      throw new Error('This desktop connection does not support the required task delivery interface.');
    }
    this.ownerId = owner.handledByClientId;
    const ready = this.waitForState();
    this.following(true);
    await ready;
    return this;
  }

  waitForState() {
    return new Promise((resolve, reject) => {
      const done = error => {
        clearTimeout(timer); this.off('state', changed); this.off('disconnect', done);
        error ? reject(error) : resolve();
      };
      const changed = () => done();
      const timer = setTimeout(() => done(new Error('No compatible task state received from Codex.')), this.timeoutMs);
      this.once('state', changed); this.once('disconnect', done);
    });
  }

  following(following) {
    this.send({ type: 'broadcast', method: 'thread-stream-following-changed', sourceClientId: this.clientId,
      targetClientIds: [this.ownerId], version: 1,
      params: { conversationId: this.threadId, hostId: 'local', following } });
  }

  send(message) {
    if (this.failure) throw this.failure;
    const body = Buffer.from(JSON.stringify(message));
    if (body.length > MAX_FRAME) throw new Error('Desktop message exceeds the IPC frame limit.');
    const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
    this.socket.write(Buffer.concat([header, body]));
  }

  request(method, params, version, targetClientId) {
    return new Promise((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        const error = new Error(`Codex ${method} timed out; delivery may have succeeded. Inspect the task before retrying.`);
        error.outcomeUnknown = true;
        reject(error);
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        this.send({ type: 'request', requestId, sourceClientId: this.clientId, version, method, params,
          timeoutMs: this.timeoutMs, ...(targetClientId ? { targetClientId } : {}) });
      } catch (error) {
        clearTimeout(timer); this.pending.delete(requestId); reject(error);
      }
    });
  }

  read(chunk) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const length = this.buffer.readUInt32LE(0);
        if (!length || length > MAX_FRAME) throw new Error('Invalid Codex IPC frame length.');
        if (this.buffer.length < length + 4) return;
        const message = JSON.parse(this.buffer.subarray(4, length + 4).toString('utf8'));
        this.buffer = this.buffer.subarray(length + 4);
        this.handle(message);
      }
    } catch (error) { this.fail(error); }
  }

  handle(message) {
    if (message.type === 'client-discovery-request') {
      this.send({ type: 'client-discovery-response', requestId: message.requestId, response: { canHandle: false } });
    } else if (message.type === 'response') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.requestId);
      if (message.resultType === 'success') pending.resolve(message);
      else {
        const error = new Error(`Codex rejected the request: ${String(message.error ?? 'unsupported response')}`);
        error.outcomeUnknown = false;
        pending.reject(error);
      }
    } else if (message.type === 'broadcast' && message.sourceClientId === this.ownerId) {
      if (message.method === 'client-status-changed' && message.params?.status === 'disconnected') {
        return this.fail(new Error('The desktop window owning this task disconnected. Reopen it and restart the adapter.'));
      }
      const params = message.params;
      if (message.method !== 'thread-stream-state-changed' || params?.conversationId !== this.threadId || params.hostId !== 'local') return;
      if (message.version !== 11) throw new Error('Unsupported Codex task-state protocol. Update the adapter before continuing.');
      const change = params.change;
      if (!Number.isInteger(change?.revision)) throw new Error('Invalid Codex task-state revision.');
      if (change.type === 'snapshot') {
        this.state = change.conversationState?.threadRuntimeStatus?.type;
      } else if (change.type === 'patches') {
        if (this.revision !== change.baseRevision || !Array.isArray(change.patches)) throw new Error('Codex task-state stream lost synchronization. Restart the adapter.');
        for (const patch of change.patches) {
          if (JSON.stringify(patch.path) === '["threadRuntimeStatus"]') this.state = patch.value?.type;
          else if (JSON.stringify(patch.path) === '["threadRuntimeStatus","type"]') this.state = patch.value;
        }
      } else throw new Error('Unsupported Codex task-state update.');
      if (!['active', 'idle'].includes(this.state)) throw new Error('The target Codex task is not available for event delivery.');
      this.revision = change.revision;
      this.emit('state', this.state);
    }
  }

  async deliver(envelope) {
    if (this.failure) throw this.failure;
    const toolOutput = { name: 'grilling_workbench_submission', namespace: null, output: JSON.stringify(envelope) };
    const start = () => this.request('thread-follower-start-turn', { conversationId: this.threadId,
      turnStart: { request: { threadId: this.threadId, input: [], toolOutput }, context: { inheritThreadSettings: true } } }, 2, this.ownerId);
    let reply;
    if (this.state === 'active') {
      const prompt = 'Saved workbench submission';
      const restoreMessage = { id: randomUUID(), text: prompt, cwd: this.cwd, createdAt: Date.now(),
        context: { prompt, addedFiles: [], fileAttachments: [], ideContext: null, imageAttachments: [], workspaceRoots: [this.cwd] } };
      try {
        reply = await this.request('thread-follower-steer-turn', { conversationId: this.threadId, input: [],
          restoreMessage, attachments: [], toolOutput }, 1, this.ownerId);
      } catch (error) {
        // Only a confirmed pre-delivery rejection permits this transition retry.
        if (error.outcomeUnknown !== false || !/SteerTurnInactiveError|NoActiveTurn|because its active turn already ended/.test(error.message)) throw error;
        reply = await start();
      }
    } else if (this.state === 'idle') reply = await start();
    else throw new Error('No compatible Codex task state is available.');
    const turnId = reply.result?.result?.turnId ?? reply.result?.result?.turn?.id;
    if (typeof turnId !== 'string') throw new Error('Codex returned an unrecognized delivery response; inspect the task before retrying.');
    return { turnId };
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      const failure = new Error(`${error.message} Delivery may have succeeded; inspect the task before retrying.`);
      failure.outcomeUnknown = true; pending.reject(failure);
    }
    this.pending.clear();
    this.socket?.destroy();
    this.emit('disconnect', error);
  }

  close() {
    if (this.ownerId && !this.failure) {
      try { this.following(false); } catch { /* Disconnect still removes the follower. */ }
    }
    this.fail(new Error('Adapter connection closed.'));
  }
}
