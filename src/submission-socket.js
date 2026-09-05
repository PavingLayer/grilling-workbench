import net from 'node:net';
import { pendingSubmissions } from './delivery.js';

// One newline-delimited JSON event per saved form. No interval or polling.
export function createSubmissionSocket(workbench, { dataDir, token } = {}) {
  const clients = new Set();
  const socketServer = net.createServer(socket => {
    clients.add(socket);
    const sent = new Set();
    const send = submission => {
      if (socket.destroyed || sent.has(submission.id)) return;
      sent.add(submission.id);
      socket.write(`${JSON.stringify({ type: 'submission', submission })}\n`);
    };
    socket.on('error', () => socket.destroy());
    socket.on('close', () => { clients.delete(socket); workbench.off('submission', send); });
    function subscribe() {
      // Subscribe before replay so a submission cannot fall between the two.
      workbench.on('submission', send);
      void pendingSubmissions(dataDir).then(submissions => {
        if (socket.destroyed) return;
        for (const submission of submissions) send(submission);
        socket.write(`${JSON.stringify({ type: 'ready' })}\n`);
      }).catch(() => {
        socket.end(`${JSON.stringify({ type: 'error', error: 'Saved submissions could not be read. They have been retained.' })}\n`);
      });
    }
    if (!token) subscribe(); // Compatibility for direct library users.
    else {
      let input = '';
      const timer = setTimeout(() => socket.destroy(), 5000);
      timer.unref();
      socket.on('close', () => clearTimeout(timer));
      const authenticate = chunk => {
        input += chunk;
        if (input.length > 4096) return socket.destroy();
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        socket.off('data', authenticate);
        clearTimeout(timer);
        let request;
        try { request = JSON.parse(input.slice(0, newline)); } catch { return socket.destroy(); }
        if (request.type !== 'subscribe' || request.protocolVersion !== 1 || request.token !== token) {
          return socket.end(`${JSON.stringify({ type: 'error', error: 'Wrong session or unsupported socket protocol. Restart the listener with the current session.' })}\n`);
        }
        subscribe();
      };
      socket.setEncoding('utf8');
      socket.on('data', authenticate);
    }
  });
  socketServer.closeClients = () => { for (const socket of clients) socket.destroy(); };
  workbench.on('close', () => { socketServer.closeClients(); if (socketServer.listening) socketServer.close(); });
  return socketServer;
}

export function waitForSubmission({ port = 4311, host = '127.0.0.1', signal, token, onReady = () => {} } = {}) {
  if (!['127.0.0.1', 'localhost'].includes(host)) throw new Error('The submission listener must be local.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host, signal });
    if (token) socket.on('connect', () => socket.write(`${JSON.stringify({ type: 'subscribe', protocolVersion: 1, token })}\n`));
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
