import net from 'node:net';
import { pendingSubmissions } from './delivery.js';

// One newline-delimited JSON event per saved form. No interval or polling.
export function createSubmissionSocket(workbench, { dataDir } = {}) {
  const clients = new Set();
  const socketServer = net.createServer(socket => {
    clients.add(socket);
    const sent = new Set();
    const send = submission => {
      if (socket.destroyed || sent.has(submission.id)) return;
      sent.add(submission.id);
      socket.write(`${JSON.stringify({ type: 'submission', submission })}\n`);
    };
    // Subscribe before replay so a submission cannot fall between the two.
    workbench.on('submission', send);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { clients.delete(socket); workbench.off('submission', send); });
    void pendingSubmissions(dataDir).then(submissions => {
      if (socket.destroyed) return;
      for (const submission of submissions) send(submission);
      socket.write(`${JSON.stringify({ type: 'ready' })}\n`);
    }).catch(() => {
      socket.end(`${JSON.stringify({ type: 'error', error: 'Saved submissions could not be read. They have been retained.' })}\n`);
    });
  });
  workbench.on('close', () => { for (const socket of clients) socket.destroy(); socketServer.close(); });
  return socketServer;
}

export function waitForSubmission({ port = 4311, host = '127.0.0.1', signal, onReady = () => {} } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('The submission listener must be local.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host, signal });
    let buffer = '', settled = false;
    const finish = (error, submission) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(submission);
    };
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 20_000_000) return finish(new Error('The submission event is too large. The saved form is retained.'));
      let newline;
      while (!settled && (newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === 'submission' && event.submission?.id) finish(null, event.submission);
          else if (event.type === 'ready') onReady();
          else if (event.type === 'error') finish(new Error(event.error));
        } catch (error) { finish(error); }
      }
    });
    socket.on('error', error => finish(error));
    socket.on('close', () => finish(new Error('The submission socket disconnected. Reconnect to receive the saved form.')));
  });
}
