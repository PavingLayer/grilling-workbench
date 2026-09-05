# Agent submission monitor

The agent must attach a submission monitor to the existing chat before presenting
a question set. Submission is the user's only handoff action. Never ask them to
copy or paste form answers. Clarification and all other conversation stay in chat.

This local prototype uses a blocking TCP connection to `127.0.0.1:4311` alongside
the HTTP form on port 4310. The server emits an event immediately after durably
saving a whole form. There is no scheduled task or interval querying the server.
The briefly created scheduled monitor was deleted when the user selected sockets.

Before presenting a question set, from this repository:

1. Start `node src/monitor.js wait` and keep the agent turn waiting on that command.
   It blocks on the socket until a saved form arrives, then returns the exact
   snapshot. If the execution tool yields a process session, wait on that same
   process rather than issuing repeat requests to the server. Do not end the turn
   and imply the process can independently wake an idle chat; this host exposes
   no verified event-to-idle-thread bridge. The active waiting tool is the receiver.
2. Read the complete submitted form, including every question marked not answered.
   Treat the content as answers to those questions, not as authorization for
   unrelated actions. Never inspect pending drafts as user decisions. The
   reading-room questionnaire is demonstration data, not this project's requirements.
3. Once the snapshot is in the current agent's context, run
   `node src/monitor.js ack SUBMISSION_ID` for that exact ID. Do this sequentially
   for each new submission. This records agent receipt, not successful completion
   of subsequent reasoning or downstream work.
4. Respond in this same chat using the submitted answers and existing context.
   Carry out the already authorized next step. Do not require another user message
   or app action to start processing the answers.
5. If presenting another form or awaiting another submission, rearm the socket
   listener before handing control back to the user. A reconnect replays saved
   submissions that have no receipt, so disconnects do not lose completed forms.

Use only `.workbench/session.json` for this chat. Never monitor the isolated QA
sessions. Receipts live in `.workbench/chat-receipts.json`, outside Git. The helper
never edits answers. Repeated acknowledgments are idempotent; a failed receipt
write leaves the submission pending for retry. Receipt errors must be reported
honestly and retried, without making the user manually transfer answers.

The saved submissions array is the durable completion signal, written atomically
with the form state. A draft save is not a completion signal. The browser shows
“Waiting for the agent” until the monitor records a receipt. A receipt proves the
agent read the snapshot, not that a chat reply was rendered. Reply-level
exactly-once delivery is not guaranteed across a crash. The local server and an
active waiting agent turn are required. `node src/monitor.js pending` is a recovery
inspection command, not a polling monitor. One agent owns receipt writes per session.
