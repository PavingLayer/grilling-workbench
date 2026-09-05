# Grilling Workbench

A standalone question-answering workbench for design conversations, opened in
the embedded browser alongside a subscription-backed ChatGPT/Codex chat.

Status: project setup and requirements only. Application code, storage choices,
frameworks, and tests have not been implemented. The project name is provisional.

A [first checkpoint design proposal](docs/design-proposal.md) develops the state
model, open choices, and verification plan. It is a draft, not accepted
requirements; no implementation choices are settled by that document.

## Project boundary

This is an independent repository, not an Inventor package, feature, or worktree.
Inventor inspired the workflow but its source, product decisions, and interview
records remain in its own project. The workbench should support other topics.

The workbench is a simple question-answering UI. The existing chat handles
reasoning and clarification under the user's chosen interview skills, including
Grill and Wayfinder. Changing the presentation does not redefine those skills.

## Initial integration

Run an ordinary local web app and open it in the host's embedded browser. The
user uses the host's native Annotate or Quick Annotate features on a question or
individual option, then sends the annotation to the existing chat. The agent
explains or changes the question definitions, causing the page content to
refresh. The user continues answering in the same form with their draft work
preserved, without submitting the round.

Clarification belongs entirely to the host and chat. The application has no
clarification markers, clarifying status, resolution controls, or submission
restrictions based on clarification. It does not track or synchronize native
comments. Displaying updated question definitions and preserving answer state
are ordinary form behavior, independent of why a definition changed.

AI conversation stays in the existing subscription-backed chat. The initial app
makes no model API calls and has no API-priced fallback. A plugin, independent AI
backend, Codex App Server, public deployment, and billing system are outside the
initial scope.

Host capability reference: [Browser documentation](https://learn.chatgpt.com/docs/browser).

## Required experience

- Show complete questions, option descriptions, and trade-offs together.
- Start unanswered. A recommendation is a label, never a preselected answer.
- Render questions and individual options distinctly so native annotations can
  target their content.
- Preserve draft work across question-definition refreshes, navigation, and
  reloads, with honest save/failure feedback. The treatment of answers whose
  question or option meaning changes remains to be designed.
- Make unanswered, draft, deferred, and submitted status visible;
  show progress without requiring the user to remember which questions they saw.
- Let deferral coexist with retained draft choices. The exact state
  representation remains to be designed.
- Submit only explicitly chosen answers: no accepted defaults, implicit
  decisions, unrelated submissions, or forced new round. Using native
  annotations requires no action or status change in the form.
- Support explicit partial submission and a review of exactly what will be sent.
- Hand off only explicitly submitted decisions. Keep deferrals distinct and leave
  questions not included in submission pending.
- Give questions and options stable identifiers. Define an explicit submitted
  answer snapshot and its handoff to the chat; the mechanism is still open.

## Testability requirement

Design the state-consistency logic for strong property-based testing from the
start. Keep the transition logic independently testable from rendering,
persistence, and chat handoff. Native annotations are outside application state.
Complement generated action-sequence
tests with focused integration and real-browser tests.

Candidate properties to refine with the state model:

- Initial state and recommendations never imply user consent.
- Editing, annotation/clarification activity, navigation, and reload do not create
  submitted decisions.
- Submitting selected answers cannot change unrelated answers.
- Failed persistence or handoff preserves recoverable drafts and reports failure.
- Repeated delivery of the same submission cannot create duplicate decisions.
- Submitted snapshots remain attributable to the exact question/option version;
  later edits cannot silently rewrite an earlier submission.
- Persisted-state round trips retain intended state, and displayed progress agrees
  with the underlying answers after any supported action sequence.

These are design/test obligations, not implemented guarantees or passing tests.

## First implementation checkpoint

Prove a small end-to-end scenario: view full options, draft an answer, annotate an
option in the embedded browser, clarify in chat, return with the draft intact,
reload, and explicitly submit only the intended answer while another question
remains pending. Also verify that agent edits to question definitions refresh
the form while preserving draft work. Verify the host annotation workflow in the
real embedded browser, not only in a mock; it requires no clarification state in
the application.

Storage, question import/update format, submission handoff, and handling changed
questions are the next design questions. Keep publishing and billing out of this
checkpoint.
