# Grilling Workbench

Local question forms for project interviews in an embedded browser. The agent
writes questions, the user submits the entire form, and a waiting socket delivers
the saved answers back to the agent. Reasoning and clarification stay in the
existing chat. No model API, external assets, or production dependencies.

**0.2.0 is an installable local CLI package.** Node.js 22 or later is required.
The supported deployment is a browser and agent on the same computer; no public
server or idle-chat wakeup service is included. The project name is provisional.

## Install in a project

Build a distributable archive from this repository:

```sh
npm ci
npm run check
npm test
npm run test:package
mkdir -p dist
npm pack --pack-destination dist
```

Then, from the consuming project:

```sh
npm install --save-dev /absolute/path/grilling-workbench-0.2.0.tgz
npx --no-install grilling-workbench install-skill
```

The installer creates `.agents/skills/grilling-workbench` and refuses to overwrite
an existing skill. Reload the host's skill catalog if needed, then invoke
`$grilling-workbench`. The package is not published to a registry yet; use the
archive, not an unverified registry package with the same name.

The [deployment guide](docs/deployment.md) covers non-Node projects, session
storage, updates, shutdown, backups, and recovery. The [integration guide](docs/integration.md)
explains skill discovery and project configuration alongside Matt Pocock's skills.

## Agent workflow

```sh
npx --no-install grilling-workbench init --session .workbench/topic-r01 --questions /absolute/path/round.json
npx --no-install grilling-workbench serve --session .workbench/topic-r01
```

Keep the server process running. In a second persistent process, **before showing
the URL returned by serve**:

```sh
npx --no-install grilling-workbench wait --session .workbench/topic-r01
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

## Agreed behavior

- The selected UI is B: a scrollable question sidebar beside the form, replaced
  by a question picker on narrow screens. Next stays visible in the footer.
- Show full questions, option descriptions, benefits, and trade-offs. Questions
  and options remain individually targetable by native browser annotations.
- Start unanswered. Recommendations label options and never select them.
- Preserve drafts across navigation, reload, and question updates. Detect changes
  to answer meaning and retain the previous wording; do not silently transfer
  consent to changed options. Report save failures and preserve recoverable work.
- Submit the whole form directly, once, with no review/confirmation screen or
  partial submissions. Submit remains usable during draft autosaves and includes
  the latest edits. Stable IDs make retries idempotent.
- A submitted blank is an explicit `not_answered` outcome. Blank drafts, deferred
  navigation, recommendations, and annotations never become project decisions.
- Keep exact immutable question versions and all outcomes in each submission.
- Emit completion over a socket only after saving. Replay unacknowledged forms
  after reconnect; record a receipt only after the agent reads the snapshot.
- Clarification, native Annotate/Quick Annotate, and every other conversation
  happen in chat. The app has no clarification markers, resolution controls,
  chatbot, or synchronization of host comments.

The parent interview workflow chooses questions and owns project decisions and
records. This repository is independent of Inventor; its source and interview
records remain outside this project's change scope. Only explicit user decisions
settle requirements.

## Development and evidence

`npm run dev` retains the original reading-room demo at
[localhost:4310](http://127.0.0.1:4310/), using `data/questions.json` and the existing
`.workbench/session.json`. Use separate CLI sessions for real projects. Demo
answers are never this project's requirements.

The pure state model has generated action-history tests plus HTTP, persistence,
socket, and runtime integration tests. The package smoke test installs the actual
archive offline in an unrelated directory and exercises the installed executable,
skill installation, concurrent isolated sessions, full submission, receipt,
definition updates, and restart. CI runs those commands for Node 22 and 24.

Earlier responsive-browser checks and known accessibility gaps are recorded in
the [historical prototype report](docs/prototype.md). The [first design proposal](docs/design-proposal.md)
is historical and superseded where it differs from the behavior above.
