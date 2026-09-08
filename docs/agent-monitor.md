# Agent submission delivery

The canonical operating instructions ship with the installable skill:
[agent protocol](../skills/grilling-workbench/references/agent-protocol.md).
Read that protocol before presenting a form. It covers preparation, the active
event receiver, receipt, continuation, definition updates, and recovery.

## Transport contract

CLI servers expose HTTP and TCP only on loopback. `serve --session DIR` writes a
private `runtime.json` descriptor with protocol version 1, actual ports, process
identity, and a random per-run token. `wait --session DIR` reads that descriptor
and connects to the matching socket. Applications should use the CLI rather than
reimplement the transport.

For transport implementers, messages are UTF-8 newline-delimited JSON. The client
first sends `{ "type": "subscribe", "protocolVersion": 1, "token": "..." }`.
Authentication must complete within five seconds and 4096 characters. The server
attaches a live listener before replaying saved unacknowledged submissions, with
per-connection ID deduplication, then sends `{ "type": "ready" }`. A replayed or
live submission may precede ready. Errors use `{ "type": "error", "error": "..." }`
and close the connection.

After a whole-form snapshot has been written, the server sends
`{ "type": "submission", "submission": {...} }`. Draft edits never emit that
event. The snapshot contains `scope: "form"`, its ID/time, questionnaire identity,
title/description, and every exact question version, answer, and outcome. The CLI
returns the first event and closes its socket; it never records receipt itself.

`ack ID --session DIR` records receipt after the agent reads the snapshot.
Acknowledgment is durable and idempotent; concurrent writers are excluded by a
lock. Reconnect replays unacknowledged submissions. There is no server polling,
heartbeat automation, or clipboard handoff.

## What delivery proves

A socket event proves the server saved the whole form. A receipt proves the agent
read that snapshot into its context. Neither proves that later reasoning finished,
a decision ticket closed, or a chat reply was rendered. Delivery is at least once
until receipt; downstream work must account for its submission ID.

A host adapter consumes these events and delivers `{session, submission}` into
the bound conversation. It must validate that binding before reporting readiness,
keep chat responsive, and leave receipt to the agent. Adapter startup and delivery
failure must be explicit; uncertain delivery must not be retried automatically.
The optional [Codex adapter](../adapters/codex/README.md) implements that boundary
in a separate executable. The core never imports host-specific code.

The browser shows waiting until the agent records receipt, even after a host
accepts delivery. Direct `wait` alone cannot wake an idle chat. Use it as an agent
wait only when the host supports interruption by new user input; otherwise use a
compatible adapter. Installing a skill cannot create an absent host capability.

The [validation note](validation.md) records the checks for active delivery,
replay, receipts, and restart, along with the limits of that evidence.
