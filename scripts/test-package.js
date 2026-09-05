// Exercises the shipped tarball from an unrelated project, without registry access.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), 'workbench-package-'));
const consumer = join(temporary, 'unrelated project');
const children = new Set();

function launch(bin, args) {
  const child = spawn(bin, args, { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  let stdout = '', stderr = '';
  const observers = new Set();
  child.stdout.on('data', chunk => { stdout += chunk; for (const fn of observers) fn(); });
  child.stderr.on('data', chunk => { stderr += chunk; for (const fn of observers) fn(); });
  const finished = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      children.delete(child);
      for (const fn of observers) fn(new Error(`Process ended early (${code ?? signal}): ${stderr}`));
      resolve({ code, stdout, stderr });
    });
  });
  const until = predicate => new Promise((resolve, reject) => {
    const timer = setTimeout(() => check(new Error(`Process readiness timed out: ${stderr}`)), 10000);
    const check = error => {
      if (!error && !predicate(stdout, stderr)) return;
      clearTimeout(timer); observers.delete(check);
      if (error) reject(error); else resolve(stdout);
    };
    observers.add(check); check();
  });
  return { child, finished, until, stop: async () => { child.kill('SIGTERM'); return finished; } };
}

try {
  await mkdir(consumer);
  const packed = JSON.parse((await exec('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: resolve('.'), maxBuffer: 5_000_000 })).stdout)[0];
  const files = packed.files.map(f => f.path);
  for (const file of ['bin/grilling-workbench.js', 'public/app.js', 'src/core.js', 'skills/grilling-workbench/SKILL.md', 'skills/grilling-workbench/references/agent-protocol.md']) assert(files.includes(file), `Missing packaged file ${file}`);
  assert(!files.some(f => /^(test|node_modules|\.workbench)\//.test(f) || f.endsWith('.png')), 'No tests, private sessions, dependencies, or mockups ship');
  await exec('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--cache', join(temporary, 'cache'), join(temporary, packed.filename)], { cwd: consumer });
  const installed = join(consumer, 'node_modules/grilling-workbench');
  const bin = join(consumer, 'node_modules/.bin/grilling-workbench');
  const command = args => exec(bin, args, { cwd: consumer });
  assert.equal((await command(['--version'])).stdout.trim(), '0.2.0');
  assert.match((await command(['--help'])).stdout, /wait --session/);
  await assert.rejects(command(['wait']), /--session DIR is required/);
  await command(['install-skill']);
  const skillPath = join(consumer, '.agents/skills/grilling-workbench/SKILL.md');
  const skill = await readFile(skillPath, 'utf8');
  await assert.rejects(command(['install-skill']), /EEXIST/);
  assert.equal(await readFile(skillPath, 'utf8'), skill);
  await command(['init', '--session', '.workbench/round-one', '--demo']);
  const session = join(consumer, '.workbench/round-one');
  const questionFile = join(session, 'questions.json');
  const questionsBefore = await readFile(questionFile, 'utf8');
  await assert.rejects(command(['init', '--session', '.workbench/round-one', '--demo']), /EEXIST/);
  assert.equal(await readFile(questionFile, 'utf8'), questionsBefore);
  await assert.rejects(command(['serve', '--session', session, '--port=-1']), /Ports must/);
  const server = launch(bin, ['serve', '--session', session]);
  const info = JSON.parse(await server.until(out => { try { return JSON.parse(out).status === 'ready'; } catch { return false; } }));
  const origin = info.url;
  for (const path of ['', 'app.js', 'styles.css', 'core.js', 'api/health']) assert.equal((await fetch(origin + path)).status, 200, path);
  assert.equal(JSON.parse((await command(['status', '--session', session])).stdout).url, origin);
  await assert.rejects(command(['serve', '--session', session]), /locked/);
  await command(['init', '--session', '.workbench/round-two', '--demo']);
  const second = launch(bin, ['serve', '--session', '.workbench/round-two']);
  const other = JSON.parse(await second.until(out => { try { return JSON.parse(out).status === 'ready'; } catch { return false; } }));
  assert.notEqual(other.url, origin);
  assert.notEqual(other.signalPort, info.signalPort);

  const listener = launch(bin, ['wait', '--session', session]);
  await listener.until((out, err) => err.includes('Listening for a saved form over TCP'));
  let saved = await (await fetch(origin + 'api/session')).json();
  const post = async action => {
    const response = await fetch(origin + 'api/actions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: saved.version, requestId: crypto.randomUUID(), action }) });
    assert.equal(response.status, 200);
    saved = await response.json();
  };
  await post({ type: 'edit', questionId: 'atmosphere', answer: { optionIds: ['quiet'], text: 'Installed package smoke test' } });
  const { makeReview } = await import(pathToFileURL(join(installed, 'src/core.js')));
  const submission = makeReview(saved.state, 'package-smoke-form', new Date().toISOString());
  await post({ type: 'submit', review: submission });
  const received = await listener.finished;
  assert.equal(received.code, 0, received.stderr);
  assert.deepEqual(JSON.parse(received.stdout).submission, submission);
  assert.deepEqual(submission.answers.map(a => a.outcome), ['answered', 'not_answered', 'not_answered']);
  assert.equal(JSON.parse((await command(['pending', '--session', '.workbench/round-two'])).stdout).submissions.length, 0);
  await command(['ack', submission.id, '--session', session]);
  await command(['ack', submission.id, '--session', session]);
  assert.equal(JSON.parse((await command(['pending', '--session', session])).stdout).submissions.length, 0);
  await assert.rejects(command(['ack', 'unknown', '--session', session]), /Only a saved submission/);

  const changed = JSON.parse(questionsBefore);
  changed.questions[0].context = 'Revised wording after the submitted round.';
  changed.questions[0].revision++;
  const revisedPath = join(consumer, 'revised.json');
  await writeFile(revisedPath, JSON.stringify(changed));
  await command(['update', '--session', session, '--questions', revisedPath]);
  const updated = await (await fetch(origin + 'api/session')).json();
  assert.equal(updated.state.questionnaire.questions[0].context, changed.questions[0].context);
  assert.deepEqual(updated.state.submissions[0], submission);
  assert.equal(updated.state.drafts.atmosphere.text, 'Installed package smoke test');
  await writeFile(revisedPath, '{broken');
  await assert.rejects(command(['update', '--session', session, '--questions', revisedPath]));
  assert.equal(JSON.parse(await readFile(questionFile, 'utf8')).questions[0].context, changed.questions[0].context);
  assert.equal((await server.stop()).code, 0);
  await assert.rejects(readFile(join(session, 'runtime.json')), { code: 'ENOENT' });
  const restarted = launch(bin, ['serve', '--session', session]);
  await restarted.until(out => { try { return JSON.parse(out).status === 'ready'; } catch { return false; } });
  assert.equal(JSON.parse((await command(['status', '--session', session])).stdout).pending, 0);
  assert.equal((await restarted.stop()).code, 0);
  assert.equal((await second.stop()).code, 0);
  console.log(`Package smoke test passed: ${packed.filename}; offline install, skill installation, isolated sessions, socket submission, receipt, updates, and restart.`);
} finally {
  for (const child of children) child.kill('SIGTERM');
  await rm(temporary, { recursive: true, force: true });
}
