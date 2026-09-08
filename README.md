# Grilling Workbench

Local question forms for project interviews in an embedded browser. The agent
writes questions, the user submits the entire form, and a host adapter delivers
the saved answers back to the existing chat without blocking clarification.
Reasoning and clarification stay in the existing chat. No model API, external
assets, or production dependencies.

Once installed, the skill applies whenever the agent interviews the user. Calling
an interview skill such as `grill-me` is enough; the user does not need to request
a browser form or enable a separate project preference.

**Run with `npx`; no project dependency is required.** Node.js 22 or later is required.
The supported deployment is a browser and agent on the same computer. The core
emits host-independent submission events; the optional Codex desktop adapter can
wake the owning conversation. No public server or scheduled monitor is included.

**Version 0.4.0 adds the optional Codex desktop adapter and companion skill.**
Install both skills below to receive submissions while keeping chat and native
annotations available. The adapter was verified on Linux with bundled Codex
0.153.0-alpha.5 and uses internal desktop IPC.

## Install in a project

From the project where you want to use the workbench:

```sh
npx skills@latest add PavingLayer/grilling-workbench \
  --skill grilling-workbench --agent codex
npx skills@latest add PavingLayer/grilling-workbench \
  --skill grilling-workbench-codex --agent codex
```

The [Skills CLI](https://github.com/vercel-labs/skills) installs the shared skill
and optional Codex companion into `.agents/skills/` and records their source in
`skills-lock.json`. For another agent, install the shared skill with that agent's
own delivery integration. Codex detects new skills automatically; restart it if the skill
does not appear. Explicit `$grilling-workbench` invocation can verify installation;
normal interview use should select it automatically.

`@latest` selects the skill installer version. The installed skill pins application
commands to `grilling-workbench@0.4.0`, which npm fetches into its cache when run.
Keep that exact application version throughout a round. The bundled `install-skill`
command remains available for [exact-release and offline installation](docs/deployment.md#bundled-installer-for-an-exact-release).

Source: [PavingLayer/grilling-workbench](https://github.com/PavingLayer/grilling-workbench).
Package: [grilling-workbench on npm](https://www.npmjs.com/package/grilling-workbench).
License: [MIT](LICENSE).

The [deployment guide](docs/deployment.md) covers non-Node projects, session
storage, updates, shutdown, backups, and recovery. The [integration guide](docs/integration.md)
explains skill discovery and project configuration alongside Matt Pocock's skills.

## Agent workflow

From this source checkout:

```sh
node bin/grilling-workbench.js init --session .workbench/topic-r01 --questions /absolute/path/round.json
node bin/grilling-workbench.js serve --session .workbench/topic-r01
```

Keep the server running. For local Codex desktop, verify the adapter and start
its listener in a second persistent process before opening the returned URL:

```sh
node bin/grilling-workbench-codex.js check
node bin/grilling-workbench-codex.js listen --session .workbench/topic-r01
```

After `listening`, leave the process alive and return control to chat. You can ask
questions and use native annotations while answering. A saved form arrives as a
tool result in the same conversation, including when that conversation was idle.
Read it, run `ack SUBMISSION_ID --session .workbench/topic-r01` with the core
executable, then continue. Host delivery never automatically acknowledges answers.

The [Codex companion skill](skills/grilling-workbench-codex/SKILL.md) owns its
connection and recovery instructions. The adapter is optional and uses internal
desktop IPC; the core has no Codex imports. Other hosts can consume the same TCP
events and implement their own delivery. Direct `wait` remains available to hosts
that can wait without blocking new user input; it cannot wake an idle chat alone.

Read the complete [shared protocol](skills/grilling-workbench/references/agent-protocol.md)
and [question format](skills/grilling-workbench/references/questions.md) before
using the tool. One directory belongs to one chat round. New rounds use new
directories; reconnects use the original exact directory.

## Answering a form

Navigate between questions using the sidebar, or the question picker on narrow
screens. The footer keeps navigation and submission actions visible. Each question
shows its full wording, options, benefits, and trade-offs. Recommendations are
labels; every question starts unanswered.

The form supports arrow keys and Vim-style keyboard control. Use `↓` / `↑`
(or `j` / `k`) to focus options and buttons, `Enter` or `Space` to activate them,
and `←` / `→` (or `h` / `l`) to change questions. Moving focus does not select
an option. Use Tab or Shift+Tab to reach the answer field; arrows move the text
cursor normally while typing.
`1`–`9` chooses or toggles an option; `i` focuses your answer or notes and `Esc`
returns to navigation. `Ctrl+Enter` (or `Cmd+Enter`) submits the whole form,
including while typing. `q` opens the question picker, `H` opens submission
history, `b` toggles the sidebar, `d` moves on to answer later, and `x` clears the
current answer and notes. `gg` / `G` focuses the first / last control, and
`Ctrl+d` / `Ctrl+u` scrolls half a page. Dialogs keep navigation inside them.

The footer shows Normal or Insert mode. Open **Keys ?** (or press `?` outside a
text field) for the guide and an option to disable Vim shortcuts, remembered in
this browser. Arrow navigation, Tab, Shift+Tab, Enter, Space, Esc, and
Ctrl/Cmd+Enter remain available with Vim shortcuts turned off.

Choices and notes save as drafts while you work. Drafts survive navigation,
reloads, and question updates. If a question's meaning changes, the app retains
your earlier answer and asks you to revisit the new wording. Save failures offer
retry and recovery options.

**Submit form** sends the entire round in one click, including edits still being
saved. Questions left blank are reported as `not_answered`. Each submission keeps
the exact question versions and answers; retries reuse its identity to prevent
duplicates. Drafts become submitted outcomes only when you explicitly submit the form.

After saving, the server emits the submission over a socket to the receiving
adapter. Unacknowledged forms replay after a reconnect, and the page shows when the
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
