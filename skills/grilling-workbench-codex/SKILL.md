---
name: grilling-workbench-codex
description: Deliver Grilling Workbench form submissions into the same local Codex desktop conversation without blocking chat. Use alongside grilling-workbench for its host connection; does not choose questions or interpret answers.
---

# Codex delivery adapter

Apply alongside the shared `grilling-workbench` skill in local Codex desktop.
The shared skill owns the interview protocol. This skill only connects saved
submission events to the exact conversation through the optional adapter.

Use application version 0.4.0 for both core and adapter. For an explicitly
configured source checkout, use `node /absolute/checkout/bin/grilling-workbench-codex.js`
instead of the packaged commands below, and use that checkout for core commands.
Retain the configured executable and version for the whole round.

## Arm delivery

1. Verify the host connection:

   ```sh
   npx --yes --package grilling-workbench@0.4.0 grilling-workbench-codex check
   ```

   The adapter uses `CODEX_THREAD_ID` from this task. If absent, supply `--thread`
   with the known exact current conversation ID. Never choose a task by recency.
   `compatible` confirms discovery and task-state support, not a saved submission.

2. After the shared skill starts the session server, start a second persistent
   process before opening the form:

   ```sh
   npx --yes --package grilling-workbench@0.4.0 grilling-workbench-codex listen --session /absolute/session/directory
   ```

   Use a short startup yield (for example `yield_time_ms: 1000`) and keep the
   process handle. Read startup output until it reports `status: "listening"`.
   If it instead reports an immediate delivery, handle the replayed submission.
   Do not continue waiting on this process after it reports listening. Open the
   form and finish the current reply; chat and native annotations remain available.

3. The adapter delivers one `grilling_workbench_submission` tool result containing
   `{session, submission}` into this exact task, starting a turn if idle or queuing
   into an active turn. Follow the shared protocol to read and acknowledge it.
   The adapter then exits. Its `delivered` status means host acceptance, not receipt
   by the agent. After acknowledgment, rearm only if this round will accept another
   submission; use a new session for new rounds.

## Recovery and compatibility

The adapter writes three private files inside the session:

- `codex-adapter.json` binds the round to its conversation. A different ID is
  rejected. Resume the original task or create a new session; do not overwrite
  the binding to make an unrelated task receive answers.
- `codex-adapter-status.json` records listening, delivered, failed, or stopped,
  with the process ID and any delivered submission/turn IDs. Read it once when
  diagnosing an interruption; it is not a polling interface.
- `codex-adapter.lock` excludes duplicate adapter processes. On a forced kill,
  verify the recorded process has exited before removing that specific stale lock.

Stopping the adapter with Ctrl+C or SIGTERM preserves saved submissions. To
recover, ensure the session server and owning desktop task are available, then
restart `listen` using the same session and conversation. Unacknowledged forms
replay. A timeout or lost connection during delivery can mean the host already
received it: inspect the task and deduplicate by submission ID before retrying.
Never auto-ack, repeatedly restart on failure, or silently fall back to a blocking
wait, heartbeat, or pasted user message.

This version uses internal local desktop IPC, verified with bundled Codex
0.153.0-alpha.5 on Linux. It requires an open desktop window owning the task and
the local Unix socket at `$CODEX_HOME/ipc/ipc.sock` (default `~/.codex/ipc/ipc.sock`).
Use `--socket PATH` only for an explicitly configured desktop socket; the adapter
checks local ownership and permissions. The CLI's App Server control socket is
a different protocol. Windows, remote tasks, desktop restart without reconnecting,
and future incompatible IPC revisions are unsupported. If checks fail, report
the missing capability instead of starting an unusable browser interview.

The adapter inherits the task's model, permission settings, and conversation.
It needs no separate model API key, scheduler, or additional Codex task.
