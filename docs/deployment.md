# Local deployment

Version 0.2.0 ships as an npm-compatible archive with a CLI, static browser files,
a demo questionnaire, operational docs, and the integration skill. It needs Node
22+ and no production dependencies or build service. Linux with Node 22.22.2 was
verified locally. CI is configured for Node 22 and 24 on Linux; other operating
systems have not been release-tested.

## Distribution and installation

From a clean checkout, run the checks in README, then:

```sh
mkdir -p dist
npm pack --pack-destination dist
```

The result is `dist/grilling-workbench-0.2.0.tgz`. The explicit package allowlist
excludes sessions, receipts, development dependencies, tests, and design images.
`npm run test:package` independently packs and installs an archive offline in a
temporary project before exercising its executable and browser endpoints.

For an existing Node project:

```sh
npm install --save-dev /absolute/path/grilling-workbench-0.2.0.tgz
npx --no-install grilling-workbench --version
npx --no-install grilling-workbench install-skill
```

For a non-Node project, a global installation avoids introducing package files:

```sh
npm install --global /absolute/path/grilling-workbench-0.2.0.tgz
grilling-workbench --version
```

Run `grilling-workbench install-skill` from each project that should discover it.
The default target is `.agents/skills/grilling-workbench`. `--target DIR` supports
another host's skill directory. This command copies the bundled skill; it does
not edit AGENTS.md, install upstream skills, or overwrite existing skills.

The package remains `private: true` and `UNLICENSED` pending an explicit public
release/license decision. Those settings do not prevent local archive installation.
No registry publication, repository creation, or global installation is performed
by building the archive. There is currently no configured Git remote.

## Session lifecycle

Every CLI operation except validation and skill installation requires an explicit
`--session DIR`. Relative paths resolve from the current working directory. Use
an absolute path when resuming from another directory. `init` refuses any existing
directory, so it cannot reset a previous form accidentally.

```sh
grilling-workbench init --session .workbench/topic-r01 --questions /absolute/path/round.json
grilling-workbench serve --session .workbench/topic-r01
```

Both servers bind exclusively to `127.0.0.1`. By default the OS assigns free HTTP
and TCP ports; use the URL returned by `serve`, not guessed port numbers. Explicit
`--port 4310 --signal-port 4311` is available when stable ports are useful. Invalid
ports and collisions fail with a nonzero exit code. Readiness follows validation,
initial storage, and successful binding of both listeners.

`serve` remains in the foreground. The agent should retain its process handle and
start `wait` in another persistent process. Ctrl+C or SIGTERM shuts down the
server, waits for queued state operations, disconnects listeners, and removes
runtime metadata and its lock. The questions, answers, and receipts remain.

`status --session DIR` makes one health request and checks the runtime identity;
`pending --session DIR` reads saved unacknowledged submissions once. Neither is a
scheduled monitor. Follow the [agent protocol](../skills/grilling-workbench/references/agent-protocol.md)
for socket waits, exact-ID receipts, and interrupted conversations.

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

For package upgrades, stop the server, back up its session directory, install the
new archive, compare the new bundled skill with the installed copy, and restart
`serve` against the same directory. To inspect a skill upgrade without overwriting
customizations, use `install-skill --target /path/to/new-empty-directory` and merge
changes deliberately. State schema 1 is retained in 0.2.0; unsupported state
versions and corrupt files fail without resetting answers.

Back up `config.json`, `questions.json`, `session.json`, and `chat-receipts.json`
with the server and receipt writer stopped. Restore those files into a private
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

## Existing checkout demo

`npm run dev` continues to use `data/questions.json` and `.workbench/session.json`
without migration or reset. `PORT` and `SIGNAL_PORT` override its defaults 4310 and
4311 independently. After upgrading, restart it so both server and monitor use
the new authenticated socket protocol. The compatibility helper
`node src/monitor.js wait` reads its descriptor; `pending` and `ack ID` use the same
original demo directory. New deployments use the CLI's initialized sessions.
