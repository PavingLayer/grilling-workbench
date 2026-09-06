# Grilling Workbench

Local question forms for project interviews in an embedded browser. The agent
writes questions, the user submits the entire form, and a waiting socket delivers
the saved answers back to the agent. Reasoning and clarification stay in the
existing chat. No model API, external assets, or production dependencies.

Once installed, the skill applies whenever the agent interviews the user. Calling
an interview skill such as `grill-me` is enough; the user does not need to request
a browser form or enable a separate project preference.

**Run with `npx`; no project dependency is required.** Node.js 22 or later is required.
The supported deployment is a browser and agent on the same computer; no public
server or idle-chat wakeup service is included.

## Install in a project

From the project where you want to use the workbench:

```sh
npx skills@latest add PavingLayer/grilling-workbench \
  --skill grilling-workbench --agent codex
```

The [Skills CLI](https://github.com/vercel-labs/skills) installs the skill from
GitHub into `.agents/skills/grilling-workbench` and records its source in
`skills-lock.json`. This command targets Codex; omit `--agent codex` to choose
another agent. Codex detects new skills automatically; restart it if the skill
does not appear. Explicit `$grilling-workbench` invocation can verify installation;
normal interview use should select it automatically.

`@latest` selects the skill installer version. The installed skill pins application
commands to `grilling-workbench@0.2.1`, which npm fetches into its cache when run.
Keep that exact application version throughout a round. The bundled `install-skill`
command remains available for [exact-release and offline installation](docs/deployment.md#bundled-installer-for-an-exact-release).

Source: [PavingLayer/grilling-workbench](https://github.com/PavingLayer/grilling-workbench).
Package: [grilling-workbench on npm](https://www.npmjs.com/package/grilling-workbench).
License: [MIT](LICENSE).

The [deployment guide](docs/deployment.md) covers non-Node projects, session
storage, updates, shutdown, backups, and recovery. The [integration guide](docs/integration.md)
explains skill discovery and project configuration alongside Matt Pocock's skills.

## Agent workflow

```sh
npx --yes grilling-workbench@0.2.1 init --session .workbench/topic-r01 --questions /absolute/path/round.json
npx --yes grilling-workbench@0.2.1 serve --session .workbench/topic-r01
```

Keep the server process running. In a second persistent process, **before showing
the URL returned by serve**:

```sh
npx --yes grilling-workbench@0.2.1 wait --session .workbench/topic-r01
```

Keep the agent turn waiting on that process. The listener blocks on TCP and exits
with the complete immutable submission. Read it in the current chat, then run
`ack SUBMISSION_ID --session .workbench/topic-r01` and continue the conversation.
No extra user click or paste is needed. The socket alone cannot start a turn in an
idle host chat; an active tool wait is required.

Read the complete [agent protocol](skills/grilling-workbench/references/agent-protocol.md)
and [question format](skills/grilling-workbench/references/questions.md) before
using the tool. One directory belongs to one chat round. New rounds use new
directories; reconnects use the original exact directory.

## Answering a form

Navigate between questions using the sidebar, or the question picker on narrow
screens. The footer keeps navigation and submission actions visible. Each question
shows its full wording, options, benefits, and trade-offs. Recommendations are
labels; every question starts unanswered.

Choices and notes save as drafts while you work. Drafts survive navigation,
reloads, and question updates. If a question's meaning changes, the app retains
your earlier answer and asks you to revisit the new wording. Save failures offer
retry and recovery options.

**Submit form** sends the entire round in one click, including edits still being
saved. Questions left blank are reported as `not_answered`. Each submission keeps
the exact question versions and answers; retries reuse its identity to prevent
duplicates. Drafts become submitted outcomes only when you click Submit.

After saving, the server delivers the submission to the waiting agent over a
socket. Unacknowledged forms replay after a reconnect, and the page shows when the
agent records receipt. The interview skill interprets answers and maintains the
project's decision records.

Use chat or native browser annotations to discuss questions and options. The
agent can explain or revise them while your draft remains in the form.

## Development and evidence

`npm run dev` starts the reading-room demo at
[localhost:4310](http://127.0.0.1:4310/), using `data/questions.json` and
`.workbench/session.json`. Use separate CLI sessions for your interviews.

To develop from a source checkout:

```sh
npm ci
npm run check
npm test
npm run test:package
```

The pure state model has generated action-history tests plus HTTP, persistence,
socket, and runtime integration tests. The package smoke test installs the actual
archive offline and through `npx` in unrelated directories and exercises the executable,
skill installation, concurrent isolated sessions, full submission, receipt,
definition updates, and restart. CI runs those commands for Node 22 and 24.

The [validation note](docs/validation.md) records the automated and browser
checks, the delivery guarantees they establish, and the remaining validation gaps.
