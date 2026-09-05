# Agent submission delivery

The canonical operating instructions ship with the installable skill:
[agent protocol](../skills/grilling-workbench/references/agent-protocol.md).
Read that protocol before presenting a form. It covers preparation, the active
socket wait, receipt, continuation, definition updates, and recovery.

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

The receiving agent must keep an active tool call waiting on the listener process.
No verified idle-chat event bridge is included. The browser correctly shows
waiting until receipt, including if the agent was interrupted. Installing the
skill does not create a host capability that is absent.

The historical reading-room test captured a user's submission on TCP, but the
agent read it after the user sent another chat message. That demonstrates durable
capture, not autonomous idle-chat wakeup. The installed-package tests verify the
active listener, replay, receipt, and restart behavior separately.
