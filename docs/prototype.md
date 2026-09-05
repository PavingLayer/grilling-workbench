# Local prototype

Built September 5, 2026. The user selected UI direction B and subsequently required
whole-form submission with immediate socket delivery to the existing chat. Storage,
import format, and handling of changed answer meanings remain prototype choices.

## Run

Use Node.js 22 or later in this repository:

```sh
npm run dev
```

Open <http://127.0.0.1:4310/>. The form is served over HTTP on port 4310; its agent
submission socket listens on loopback port 4311. `PORT` and `SIGNAL_PORT` override
these ports. There are no production dependencies, model calls, external assets,
build step, or public deployment. Run one server per saved session.

Before presenting the form, the agent starts `node src/monitor.js wait` and waits
on that process. It blocks on TCP; it does not poll the server. Follow the complete
[agent monitor protocol](agent-monitor.md), including receiving and acknowledging
the exact snapshot in the existing chat. The active waiting agent turn is required;
the socket alone cannot start a new turn in an idle host chat.

## Answer and submit

The reading-room demo has single-choice, multiple-choice, and written questions.
No answer starts selected. Choose an option, write an answer, or leave a question
blank. **Answer later** moves to the next question while retaining the current
fields. It does not send anything or create a special communication state.

The dark sidebar shows concise question labels and scrolls independently of the
form. **Next question** stays primary in the persistent footer. **Submit form** is
secondary until the final question, where it becomes the primary action. Below 641 pixels, or when the sidebar is
collapsed, **Question N of total** opens a scrollable question picker. Answer later
and Clear answer are distinct bordered buttons. Clear responds immediately to typing.

**Submit form** sends the entire set immediately, including blank fields as
explicit not-answered outcomes. There is no review screen or additional
confirmation. Revisit answers through ordinary navigation before submitting.
The button stays enabled during draft autosaves: a click captures the latest
answers, then the save queue persists pending edits before the submission.
It becomes unavailable only for an already queued submission or a version
conflict. Merely leaving a field blank while editing does not communicate a decision.

After the server durably saves the immutable form snapshot, it emits the complete
submission over the waiting socket. The agent reads it and acknowledges receipt.
The page distinguishes **Waiting for the agent** from **Received by the agent**.
There is no copy button or required manual handoff. Earlier submitted forms remain
available in Submissions, including through the compact question picker.

Use native Annotate/Quick Annotate and the existing chat for clarification or any
other communication. The app does not model, synchronize, or resolve comments.

## Implementation choices

| Concern | Prototype behavior |
| --- | --- |
| Rendering | Plain HTML, CSS, and browser ES modules served locally by Node. |
| Drafts | `.workbench/session.json`, excluded from Git; temporary write, file sync, and atomic rename. Save success follows persistence. |
| Definitions | `data/questions.json`, validated by the server. Ordinary page refresh checks every 2.5 seconds when no local edits await saving. This is independent of the event-driven submission monitor. |
| Whole-form snapshot | Stable ID, preparation time, form identity/title/description, every question version, answer contents, and `answered` or `not_answered` outcome. No subset is accepted. |
| Changed questions | Earlier drafts are retained. Changed answered questions require reviewing the new wording or editing before submission. Removed choices require another answer or clearing it. Historical submissions stay immutable. |
| Socket delivery | A blocking TCP subscriber receives saved forms immediately. Unreceived forms replay on reconnect. Drafts never emit submission events. |
| Receipt | `.workbench/chat-receipts.json` records that the agent read a snapshot. Repeated acknowledgment is idempotent. A failed receipt write leaves the form pending for recovery. |
| Multiple tabs | Version conflicts retain this tab's work and offer recovery export or explicit loading of the saved version. No automatic merge. |

Receipt status is queried by the page while it checks for definition updates; the
agent completion monitor itself is socket-driven. A receipt proves agent input,
not completion of downstream reasoning or successful rendering of a chat reply.
The local server and waiting agent must remain available. An interrupted agent
can reconnect and receive any snapshot that lacks a receipt. Exactly-once chat
replies across crashes are not guaranteed.

## Editing questions

Edit `data/questions.json`. Keep the questionnaire ID for the same session and
stable IDs for the same questions/options. Increase a question's revision when
changing its meaning. Commit tracked definition changes under the working agreement.

Each question contains `id`, `revision`, `title`, `context`, `type`, and `options`.
Types are `single`, `multiple`, and `text`; text questions have an empty options
array. Options contain `id`, `label`, `description`, `benefit`, `tradeoff`, and an
optional `recommended` boolean. Recommendations never select an answer.

The optional questionnaire-level `navigationLabels` map provides concise sidebar
labels keyed by question ID. These labels do not change question meaning or
invalidate an existing reviewed answer. The full title remains on the form.

Invalid definitions retain saved answers and report an error. Deleted questions'
drafts remain stored, outside the current form. Previous partial submissions, if
present in an older prototype session, remain immutable historical data; new
submissions always cover the entire current form.

## Recovery

A failed write keeps unsaved work in the open tab and offers retry and a recovery
download. Unsaved memory cannot survive a closed tab. A failed refresh does not
mean an earlier successful save was lost. Disk failure, device loss, unlimited
history, and concurrent server processes sharing files remain outside the prototype.

Recovery import is manual: validate the exported `state` with `restoreState`, keep
the earlier file as a backup, and restore a session envelope while the server is
stopped. The envelope contains `version`, `operations`, and `state`. Never replace
a corrupt saved session with an empty one. The server accepts only its own local
origin and serves a fixed allowlist.

## Validation

```sh
npm ci
npm run check
npm test
```

All 16 tests passed, including 1,000 generated action histories with fixed seed
`20260905`. `FC_SEED` and `FC_PATH` can reproduce and shrink other generated cases.
Checks cover immutable snapshots, full-set validation, blank outcomes, stale
reviews, preserved drafts, definition changes, retries, persistence failures,
server restart, conflicts, and local API boundaries. Socket tests hold the storage
write open to verify that completion is emitted only after persistence, then
verify reconnect replay, receipt failure recovery, and acknowledgment deduplication.

Embedded-browser checks verified:

- Direction B with 20 questions at 808×1139: independent scrolling for sidebar and
  form, direct navigation to question 20, footer remaining visible, no horizontal
  overflow, and selection preserving the current scroll position.
- Narrow layouts at 390×844 and 320×740: scrollable question picker, visible footer
  actions, no horizontal overflow, draft persistence after reload, and accessible
  submission history with the sidebar hidden.
- Whole-form submission with one answer and two blanks; the actual TCP listener received
  all three questions and the two `not_answered` outcomes immediately on submission.
  Recording the receipt changed the page to “Received by the agent in chat.”
- Direct submission was tested with two successive text edits and deliberately
  delayed draft saves. Submit remained enabled while the status read “Saving…”,
  and one click sent the latest text plus the two not-answered outcomes over TCP
  without a review screen.
- The original preview's social option draft survived the redesign. QA used separate
  sessions and did not submit that user's draft.

Earlier browser checks also verified definition refresh while retaining draft
text, recoverable save failures, and server restart. Their earlier review, partial-submit,
and clipboard scenarios are superseded by direct whole-form socket delivery.

The user's native footer annotation on this prototype arrived in chat and drove
the navigation fix. A dedicated option-targeted clarification round trip and
screen-reader testing remain outstanding; those have not been fabricated.
