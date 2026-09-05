import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkbench, handleShutdown } from './runtime.js';

// Compatibility entrypoint for the existing checkout demo and saved answers.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const running = await startWorkbench({ dataDir: join(root, '.workbench'), questionsPath: join(root, 'data/questions.json'), port: Number(process.env.PORT || 4310), signalPort: Number(process.env.SIGNAL_PORT || 4311) });
  handleShutdown(running);
  console.log(`Workbench: ${running.info.url}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
