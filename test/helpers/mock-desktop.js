import net from 'node:net';
import { once } from 'node:events';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';

export async function mockDesktop(directory, { state = 'active', version = 11, rejectDelivery, silentDelivery = false } = {}) {
  const sockets = new Set(), requests = [], deliveries = [];
  const socketPath = join(directory, 'desktop.sock');
  const owner = 'test-desktop-owner';
  const frame = message => {
    const body = Buffer.from(JSON.stringify(message)), header = Buffer.alloc(4);
    header.writeUInt32LE(body.length); return Buffer.concat([header, body]);
  };
  const server = net.createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= buffer.readUInt32LE(0) + 4) {
        const length = buffer.readUInt32LE(0), message = JSON.parse(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4);
        if (message.type === 'request') {
          requests.push(message);
          const respond = result => {
            const bytes = frame({ type: 'response', requestId: message.requestId, resultType: 'success', handledByClientId: owner, result });
            socket.write(bytes.subarray(0, 2)); socket.write(bytes.subarray(2)); // Fragmented frames are valid.
          };
          if (message.method === 'initialize') respond({ clientId: 'test-adapter-client' });
          else if (message.method === 'thread-owner-discovery') { socket.threadId = message.params.conversationId; respond({ supportsUntrustedAppInput: true }); }
          else {
            deliveries.push(message);
            const rejection = rejectDelivery?.(message);
            if (rejection) socket.write(frame({ type: 'response', requestId: message.requestId, resultType: 'error', error: rejection }));
            else if (!silentDelivery) respond(message.method === 'thread-follower-start-turn' ? { result: { turn: { id: 'new-turn' } } } : { result: { turnId: 'active-turn' } });
          }
        } else if (message.type === 'broadcast' && message.method === 'thread-stream-following-changed') {
          if (message.params.following) socket.write(frame({ type: 'broadcast', sourceClientId: owner, version,
            method: 'thread-stream-state-changed', params: { hostId: 'local', conversationId: socket.threadId,
              change: { type: 'snapshot', revision: 1, conversationState: { threadRuntimeStatus: { type: state } } } } }));
        }
      }
    });
  });
  server.listen(socketPath); await once(server, 'listening'); await chmod(socketPath, 0o600);
  return { socketPath, requests, deliveries,
    broadcast: message => { for (const socket of sockets) socket.write(frame(message)); },
    disconnect: () => { for (const socket of sockets) socket.destroy(); },
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}
