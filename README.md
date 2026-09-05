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

The workbench manages questions and answer state. The existing chat handles
reasoning and clarification under the user's chosen interview skills, including
Grill and Wayfinder. Changing the presentation does not redefine those skills.

## Initial integration

Run an ordinary local web app and open it in the host's embedded browser. The
user can annotate a question or an individual option with a specific doubt and
share that annotation in the existing chat. They can then return to the same
questionnaire and continue without submitting the round.

Native browser annotations belong to the host. They do not automatically update
application state, submit answers, or provide a documented two-way data channel.
Any local clarification marker must be explicit, not presented as automatically
synchronized with host comments.

AI conversation stays in the existing subscription-backed chat. The initial app
makes no model API calls and has no API-priced fallback. A plugin, independent AI
backend, Codex App Server, public deployment, and billing system are outside the
initial scope.

Host capability reference: [Browser documentation](https://learn.chatgpt.com/docs/browser).

## Required experience

- Show complete questions, option descriptions, and trade-offs together.
- Start unanswered. A recommendation is a label, never a preselected answer.
- Make questions and individual options distinct annotation targets.
- Preserve drafts across clarification, navigation, and reloads, with honest
  save/failure feedback.
- Make unanswered, draft, clarifying, deferred, and submitted status visible;
  show progress without requiring the user to remember which questions they saw.
- Let clarification and deferral coexist with retained draft choices. The exact
  state representation remains to be designed.
- Keep clarification independent from submission: no accepted defaults, implicit
  decisions, unrelated submissions, or forced new round.
- Support explicit partial submission and a review of exactly what will be sent.
- Hand off only explicitly submitted decisions. Keep deferrals distinct and leave
  unanswered or clarifying questions pending.
- Give questions and options stable identifiers. Define an explicit submitted
  answer snapshot and its handoff to the chat; the mechanism is still open.

## Testability requirement

Design the state-consistency logic for strong property-based testing from the
start. Keep the transition logic independently testable from rendering, browser
annotations, persistence, and chat handoff. Complement generated action-sequence
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
remains pending. Verify the host annotation workflow in the real embedded browser,
not only in a mock.

Storage, question import/update format, submission handoff, and handling changed
questions are the next design questions. Keep publishing and billing out of this
checkpoint.
