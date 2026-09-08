# Local deployment

Version 0.4.0 adds an optional Codex desktop adapter and companion skill.
The package includes a CLI, static browser files, a demo questionnaire,
operational docs, and skills. It needs Node 22+ and no production dependencies
or build service. Linux with Node 22.22.2 was
verified locally. CI is configured for Node 22 and 24 on Linux; other operating
systems have not been release-tested.

## Distribution and installation

Run this from any project, including a non-Node project:

```sh
npx skills@latest add PavingLayer/grilling-workbench \
  --skill grilling-workbench --agent codex
npx skills@latest add PavingLayer/grilling-workbench \
  --skill grilling-workbench-codex --agent codex
npx --yes grilling-workbench@0.4.0 --version
```

The [Skills CLI](https://github.com/vercel-labs/skills) installs the skill from
GitHub into `.agents/skills/grilling-workbench` and records its source in
`skills-lock.json`. The command targets Codex; omit `--agent codex` to choose
another agent. No project dependency or global installation is required.

`@latest` selects the installer version; the skill pins the application to `0.4.0`.
The version check above fetches that application into npm's execution cache.
Keep `@0.4.0` on every application command so the server and listener use the
release required by the skill. Initial setup needs npm registry and GitHub access;
use an explicit archive installation when reliable offline availability matters.

Source and releases are maintained at
[PavingLayer/grilling-workbench](https://github.com/PavingLayer/grilling-workbench).
The public npm package is
[grilling-workbench](https://www.npmjs.com/package/grilling-workbench).

### Bundled installer for an exact release

To install the skill bundled with a specific application release, use:

```sh
npx --yes grilling-workbench@0.4.0 install-skill
npx --yes grilling-workbench@0.4.0 install-skill --skill grilling-workbench-codex
```

Run this from each project that should discover it. The default target is
`.agents/skills/grilling-workbench`. `--target DIR` supports another host's skill
directory. This command copies the bundled skill; it does not edit AGENTS.md,
install upstream skills, or overwrite existing skills. This installer does not
create a Skills CLI lockfile.

If you prefer a project dependency:

```sh
npm install --save-dev --save-exact grilling-workbench@0.4.0
npx --no grilling-workbench install-skill
```

Or explicitly install the executable globally:

```sh
npm install --global grilling-workbench@0.4.0
grilling-workbench --version
grilling-workbench install-skill
```

### Offline archives and maintainer releases

From a clean source checkout:

```sh
npm ci
npm run check
npm test
npm run test:package
mkdir -p dist
npm pack --pack-destination dist
```

The result is `dist/grilling-workbench-0.4.0.tgz`. The explicit package allowlist
excludes sessions, receipts, development dependencies, and tests. The package
tests exercise both an offline project installation and `npx` execution from an
isolated cache, including full form delivery, updates, shutdown, and restart.
Building the archive does not publish it.

Offline consumers can install the archive as a project dependency or globally:

```sh
npm install --offline --save-dev /absolute/path/grilling-workbench-0.4.0.tgz
npx --no grilling-workbench install-skill
```

Configure the agent to use that installed executable at the matching version;
the bundled skill defaults to the version-pinned `npx` registry command.

### Publishing through GitHub Actions

[Publish npm](../.github/workflows/publish.yml) publishes stable GitHub releases
through [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
It checks out the release tag, verifies its package version, runs the full test
suite, and builds the archive. An existing GitHub attachment must match exactly;
otherwise the workflow attaches the archive before publishing those same bytes
to npm. A retry skips publishing only if npm already has the identical archive.
The final integrity check waits up to five minutes for npm processing and retries
temporary registry responses; an archive mismatch fails immediately.

Configure this trusted publisher once in the npm package's Settings tab:

| Setting | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `PavingLayer` |
| Repository | `grilling-workbench` |
| Workflow filename | `publish.yml` |
| Environment name | `npm` |
| Allowed action | Direct publishing with `npm publish` |

npm requires account verification to change these settings. The workflow uses
the `npm` GitHub environment and OIDC; it needs no `NPM_TOKEN` or `NODE_AUTH_TOKEN`
secret. Node 24 and a pinned npm CLI provide trusted-publishing support. The
workflow has permission to attach release archives and request an OIDC token.

After bumping the package version and updating the docs and bundled skill pins,
push the source and wait for GitHub checks. Create a stable `vVERSION` GitHub
release to trigger publishing. For an existing release, or to retry:

```sh
gh workflow run publish.yml --ref main -f tag=v0.4.0 -f dry_run=true
gh workflow run publish.yml --ref main -f tag=v0.4.0 -f dry_run=false
```

Manual runs must use `main` and a published stable release tag. Dry runs validate
the archive without uploading or publishing it. The first command is useful for
checking setup before enabling the trusted publisher. Follow the run through its
final npm integrity check to confirm publication. Never overwrite a published
version or run mixed versions within a round.

## Session lifecycle

Every CLI operation except validation and skill installation requires an explicit
`--session DIR`. Relative paths resolve from the current working directory. Use
an absolute path when resuming from another directory. `init` refuses any existing
directory, so it cannot reset a previous form accidentally.

```sh
npx --yes grilling-workbench@0.4.0 init --session .workbench/topic-r01 --questions /absolute/path/round.json
npx --yes grilling-workbench@0.4.0 serve --session .workbench/topic-r01
```

Both servers bind exclusively to `127.0.0.1`. By default the OS assigns free HTTP
and TCP ports; use the URL returned by `serve`, not guessed port numbers. Explicit
`--port 4310 --signal-port 4311` is available when stable ports are useful. Invalid
ports and collisions fail with a nonzero exit code. Readiness follows validation,
initial storage, and successful binding of both listeners.

`serve` remains in the foreground. The agent should retain its process handle and
start the selected adapter in another persistent process. Once listening, return
control to chat. The Codex companion exits after delivering one submission; rearm
only when this round needs another submission. Ctrl+C or SIGTERM shuts down the
server, waits for queued state operations, disconnects listeners, and removes
runtime metadata and its lock. The questions, answers, and receipts remain.

`status --session DIR` makes one health request and checks the runtime identity;
`pending --session DIR` reads saved unacknowledged submissions once. Neither is a
scheduled monitor. Follow the [agent protocol](../skills/grilling-workbench/references/agent-protocol.md)
for adapter delivery, exact-ID receipts, and interrupted conversations.
The [Codex companion](../skills/grilling-workbench-codex/SKILL.md) documents its
separate executable, connection check, and recovery.

## Stored files and ownership

| File inside the session | Purpose |
| --- | --- |
| `config.json` | Versioned session configuration. |
| `questions.json` | Session-owned definitions copied by init; use update to replace atomically. |
| `session.json` | Versioned state, drafts, request deduplication, and immutable submissions. |
| `chat-receipts.json` | Submission IDs read by the agent and receipt times. |
| `runtime.json` | Ephemeral process identity, ports, and random socket credential. |
| `server.lock` | Exclusive server ownership; PID and start time for recovery. |
| `receipt.lock` | Short-lived acknowledgment writer ownership. |
| `codex-adapter.json` | Optional adapter's persistent exact-conversation binding. |
| `codex-adapter-status.json` | Optional adapter's last status, PID, and delivery IDs. |
| `codex-adapter.lock` | Optional adapter process ownership. |
| `.gitignore` | Keeps runtime content out of ordinary Git additions. |

Files are written with mode 0600 and newly created session directories with 0700
on systems honoring POSIX permissions. Existing parent permissions are not changed.
Keep sessions on a local disk; network filesystems and multiple machines sharing
one session are unsupported. One server owns a session. Concurrent acknowledgment
writers fail instead of losing another writer's receipt; retry sequentially.

The browser serves a fixed file allowlist, rejects unrelated Host/Origin headers,
and escapes question text. The TCP subscriber supplies a per-run random token
read from the session descriptor; a stale or wrong session is rejected. No token
is printed in normal CLI output or sent to the browser. This is a single-user
local tool, not a multi-tenant service: other trusted processes on the same
computer can access its local HTTP API. Do not expose either port through a public
proxy. There is no remote authentication or TLS deployment mode.

## Update and recovery

Use `update --session DIR --questions FILE` to validate and atomically replace the
current definitions. Keep the form ID. The browser checks ordinary definition and
receipt refreshes every 2.5 seconds while local saves are settled; **agent completion
uses TCP events, not this refresh interval**. The [question format](../skills/grilling-workbench/references/questions.md)
describes changed-answer handling and size limits.

For package upgrades, stop the server, back up its session directory, select the
new exact package version, compare its bundled skill with the installed copy, and
restart `serve` at that version against the same directory. Update a local or
global installation explicitly if you use one. To inspect a skill upgrade without overwriting
customizations, use `install-skill --target /path/to/new-empty-directory` and merge
changes deliberately. State schema 1 is retained in 0.4.0; unsupported state
versions and corrupt files fail without resetting answers.

When upgrading a skill through the Skills CLI, review its changes and use the
exact application version required by the updated skill for subsequent rounds.
Finish active rounds with their original skill instructions and application
version before upgrading.

Back up `config.json`, `questions.json`, `session.json`, `chat-receipts.json`, and
any `codex-adapter.json` binding with the server, adapter, and receipt writer stopped. Restore those files into a private
session directory, then start serve. Do not restore `runtime.json` or lock files;
those describe processes, not answers. Atomic replacement and file synchronization
protect against interrupted writes; backups remain necessary for device loss or
filesystem failure. Power-loss durability across every filesystem is not guaranteed.

A forced kill can leave a lock. Read its PID/start time and verify that its owner
has exited using the operating system's process inspection. Only then remove
that specific stale lock (and stale runtime descriptor for a server lock) and
restart/retry. Never remove a live owner's lock. The program deliberately does not
steal locks based only on age or a potentially reused PID. If ownership cannot be
established, keep the files and resolve it before restarting.

A failed browser save leaves unsaved work in the open tab, with retry and recovery
export. Closing the tab loses memory that never reached storage. A failed receipt
keeps the submission available for replay. A crash after receipt can leave
unfinished downstream work; the immutable submission and chat/handoff record
support recovery, but exactly-once replies are not guaranteed.

## Source checkout demo

`npm run dev` serves the demo from `data/questions.json` and saves its answers in
`.workbench/session.json`. `PORT` and `SIGNAL_PORT` override its defaults 4310 and
4311 independently. The source-checkout helper `node src/monitor.js wait` reads
the demo's runtime descriptor; `pending` and `ack ID` use the same demo directory.
Use the CLI's initialized sessions for project interviews.
