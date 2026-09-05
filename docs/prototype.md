# Local prototype

Built September 5, 2026. This implementation is for trying the agreed simple form
experience. It does not settle the open storage, import, handoff, or changed-answer
policies from the design proposal.

## Run

Use Node.js 22 or later, from the repository root:

```sh
npm run dev
```

Open <http://127.0.0.1:4310/> in the embedded browser. The app has no production
dependencies, build step, model calls, external assets, or public deployment.
`PORT=4312 npm run dev` uses another local port. Run one server process per saved
session; concurrent server processes sharing the same files are not supported.

The initial questionnaire is a clearly labeled reading-room demonstration with
single-choice, multiple-choice, and written answers. No answer starts selected.

## Try the form

Choose an option and optionally add a note, or write an answer in your own words.
Move between questions freely. **Answer later** preserves the draft and adds a
deferral indicator. It has no separate clearing prerequisite for submission.

**Review answers** becomes available after a draft has saved. The review starts
with no answers selected. Choose answers to include, inspect the exact submission
and the pending-question list, then explicitly submit. Only those answers appear
in the immutable submission. **Copy for chat** copies this saved snapshot; it
does not send a chat message. Earlier submissions remain available for recopying.

Use native Annotate or Quick Annotate on ordinary question or option content and
send the comment in the existing chat. The app contains no clarification state,
controls, native-comment synchronization, or agent-facing browser tool layer.

## Provisional implementation choices

| Concern | Prototype behavior |
| --- | --- |
| Rendering | Plain HTML, CSS, and browser ES modules, served by Node's local HTTP server. |
| Draft storage | `.workbench/session.json`, excluded from Git. Writes use a temporary file, file sync, and atomic rename. Saving success is shown only after the server write succeeds. |
| Question source | `data/questions.json`. The server validates definitions before using them. The page checks for changes every 2.5 seconds when no local edits await saving. |
| Question identity | Questionnaire ID, stable question and option IDs, and a positive integer question revision. Exact question wording is retained in drafts and submission snapshots. |
| Changed wording | Retain the old draft. Show a small update notice and let the user explicitly keep that answer with the new wording or edit it. Removed choices require a new answer. Previous draft versions are retained in the saved data. This is question-version handling, independent of clarification. |
| Submission | Explicit selection and review, then an immutable snapshot. Repeated delivery of the same submission ID cannot create another local submission. The snapshot's preparation time is labeled as such. |
| Handoff | A copyable Markdown snapshot containing only the submitted questions and answers. Clipboard failure leaves selectable text and a saved submission. Chat receipt and deduplication are not automatically verified. |
| Multiple tabs | Version conflicts stop a stale write, retain this tab's work, and offer recovery export or an explicit load of the saved version. Conflicts are not automatically merged. |

## Editing questions

Edit `data/questions.json` in this repository. Keep the questionnaire ID for the
current session. Keep IDs for the same questions/options; increase the question
revision when changing its meaning. Add or remove questions/options as needed.
All changes to tracked question definitions must be committed under the repository
working agreement.

Each question contains `id`, `revision`, `title`, `context`, `type`, and `options`.
Supported types are `single`, `multiple`, and `text`; text questions use an empty
options array. Each option contains `id`, `label`, `description`, `benefit`,
`tradeoff`, and optionally `recommended: true`. The recommendation is only a label.

Invalid definitions leave the saved answers intact and produce a visible error.
Fix the question file and retry. Deleted questions' drafts remain in the saved
data but are not displayed in the current questionnaire. Multiple questionnaire
sessions and an import interface are outside this prototype.

## Recovery and practical limits

When a write fails, the page retains unsaved work and offers retry and a JSON
recovery download. Keep the page open until retry succeeds or the recovery copy
is downloaded. No application can guarantee survival of unsaved in-memory changes
after a tab closes. A failed refresh does not mean an earlier successful save was
lost.

The recovery file includes the current state and pending operations. Recovery
import is manual in this prototype: ask the agent to inspect the file, validate
its `state` with `restoreState`, and restore a session envelope while the server
is stopped, preserving the previous session file as a backup. The normal session
envelope has `version`, `operations`, and `state` fields. Do not replace a corrupt
file with an empty session; retain it for recovery.

Storage is local and supports one server process. Atomic replacement protects
against an interrupted file write; disk failure, device loss, unlimited history,
and multiple processes writing the same file are not solved by this prototype.
The server binds to loopback, serves a fixed file allowlist, and rejects requests
with unrelated hosts or origins.

## Validation

```sh
npm ci
npm run check
npm test
```

All 11 tests passed. The generated test runs 1,000 action histories against an
independent small reference model, checking invariants after each action. It
includes drafts, deferrals, definition changes, explicit submission, retries,
restore, and navigation. Its fixed seed is `20260905`; use `FC_SEED` and optionally
`FC_PATH` from a failure report to reproduce another generated run. The library
shrinks failures to smaller counterexamples.

Focused tests cover stale reviews, removed choices, immutable attribution,
partial-submission isolation, invalid persisted state, disk-write failure, server
restart, conflicting requests, definition refresh, and local API boundaries.

Real embedded-browser checks used a separate sample session and verified:

- Initial recommended options and review checkboxes are unselected.
- Choosing an option, typing a note, deferring, and reloading preserves the draft
  with zero submissions.
- An agent edit to the question file refreshes the wording automatically while
  preserving the earlier answer and note.
- Two selected options on another question remain a draft when only the first
  answer is reviewed and submitted. A third question stays unanswered.
- The saved handoff contains only the selected answer and copies successfully.
- After reload, progress shows one submitted answer and two pending questions.
- A failed load/save retains newly typed text; retry saves it after the question
  source is repaired.
- The normal preview returns to a separate, clean questionnaire with no test
  answers or submissions.

The earlier user annotation on log-analysis demonstrated native comment delivery
to chat. The remaining manual checkpoint is a user-authored annotation on this
prototype followed by clarification in this chat. That step has not been claimed
as tested, and no user annotation or decision has been fabricated. Dedicated
narrow-mobile, screen-reader, and full browser concurrency tests remain future
validation work.
