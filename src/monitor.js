import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acknowledgeSubmission, pendingSubmissions } from './delivery.js';
import { waitForSubmission } from './submission-socket.js';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, id] = process.argv.slice(2);
    if (command === 'pending') console.log(JSON.stringify({ submissions: await pendingSubmissions() }, null, 2));
    else if (command === 'wait') {
      const submission = await waitForSubmission({ port: Number(process.env.SIGNAL_PORT || 4311), onReady: () => console.error('Listening for a saved form over TCP. No polling.') });
      console.log(JSON.stringify({ submission }, null, 2));
    }
    else if (command === 'ack' && id) console.log(JSON.stringify(await acknowledgeSubmission(id)));
    else throw new Error('Use: node src/monitor.js wait | pending | ack SUBMISSION_ID');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
