# Optional Codex desktop adapter

This executable consumes the workbench's existing saved-submission socket and
delivers its immutable `{session, submission}` envelope into one exact local
Codex conversation. The form server, state model, submission protocol, and receipts
remain host-independent. No core module imports this adapter.

From a source checkout, use:

```sh
node bin/grilling-workbench-codex.js check
node bin/grilling-workbench-codex.js listen --session /absolute/session/directory
```

The session server must already be running. `check` is read-only. `listen` binds
the round to `CODEX_THREAD_ID` (or explicit `--thread ID`), excludes duplicate
listeners, and reports `listening` after the desktop and submission socket are
ready. Leave that process running and return control to chat. It delivers one
submission and exits; only the receiving agent records acknowledgment.

The [companion skill](../../skills/grilling-workbench-codex/SKILL.md) is the
canonical guide for installed commands, agent behavior, and recovery. Install it
alongside the shared skill only for this host. Both executables and skills are
included in the 0.4.0 package.

## Boundary and compatibility

`desktop.js` owns the internal Codex IPC framing, discovery, task state, and turn
delivery. `listen.js` connects that host-specific client to the unchanged core
event stream. `cli.js` supplies optional commands; the core CLI only adds generic
selection of bundled skills through `install-skill --skill NAME`.

The adapter verifies the socket's local ownership, discovers the exact task owner,
and checks task-state protocol compatibility. A failed or uncertain delivery
retains the saved form without a receipt. The only automatic retry is a confirmed
active-turn-ended rejection, followed once by the idle-turn delivery route.
Timeouts, disconnects, or unknown responses require inspection before restarting.

This implementation uses internal desktop IPC verified on Linux with bundled
Codex 0.153.0-alpha.5. It needs the owning desktop window open. Windows and remote
tasks are unsupported; desktop/window restart requires reconnecting. Another host
can consume the same core events with its own adapter, without changing question
schemas or the shared interview protocol.
