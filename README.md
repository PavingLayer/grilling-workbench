# Grilling Workbench

A standalone question-answering workbench for design conversations, opened in
the embedded browser alongside a subscription-backed ChatGPT/Codex chat.

Status: a local prototype is implemented, with generated state tests and local
server integration tests. Run `npm run dev` with Node.js 22 or later, then open
[the local workbench](http://127.0.0.1:4310/). The project name is provisional.

The [prototype guide](docs/prototype.md) records how to run it, update questions,
and interpret the validation results and remaining limitations. Its storage,
format choices are provisional implementation choices for trying
the experience, not newly accepted requirements.

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

Submission is one action for the entire question set. The saved snapshot includes
every question: a selected/written answer or an explicit **Not answered** outcome.
A blank field becomes that decision only when the user submits the form. There
are no partial submissions or required copy/paste steps. Everything other than
form submission is discussed in the existing chat.

Before presenting questions, the agent must arm a blocking socket listener. The
server emits the complete submission after its durable save; the waiting agent
receives it, records a receipt, and continues this chat. The current prototype
uses a local TCP socket with replay of unreceived submissions, described in the
[agent monitor protocol](docs/agent-monitor.md). The agent keeps its turn waiting
on the socket; a disconnected or idle agent cannot be claimed to have received
anything. No scheduled polling monitor is used.

The user selected **B — Visible navigator**: a scrollable question sidebar beside
the form, with Next visible in the footer. At narrow widths, a scrollable question
picker replaces the sidebar. The [generated concepts](docs/ui-concepts/README.md)
record the visual choice.

## Required experience

- Show complete questions, option descriptions, and trade-offs together.
- Start unanswered. A recommendation is a label, never a preselected answer.
- Render questions and individual options distinctly so native annotations can
  target their content.
- Preserve draft work across question-definition refreshes, navigation, and
  reloads, with honest save/failure feedback. The treatment of answers whose
  question or option meaning changes remains to be designed.
- Show which questions have answers and whether the whole form has been submitted.
  Navigation and answering later retain existing draft choices and text.
- Start and remain a draft until the user explicitly submits the whole form.
  Recommendations, navigation, and native annotations never submit decisions.
- Submit the complete form directly in one click, with no review screen or extra
  confirmation step. Users can navigate freely to revisit answers before submitting.
  Blank answers are allowed and explicitly represented as not answered in the snapshot.
- Keep Submit stable and usable during draft autosaves. Submission captures the
  latest in-memory answers and saves pending edits before the complete form.
- Automatically deliver the submitted form to the waiting agent in the same chat,
  including all not-answered decisions. No further user click or paste is required.
- Give questions, options, and submissions stable IDs. Retain immutable copies of
  the exact submitted question versions and outcomes, and support retry without
  creating another submission for the same ID.

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
- Every submission covers the entire question set at the submit click, including blanks;
  the server rejects a subset or a snapshot prepared before the question set changed.
- Failed persistence or handoff preserves recoverable drafts and reports failure.
- Repeated delivery of the same submission cannot create duplicate decisions.
- Submitted snapshots remain attributable to the exact question/option version;
  later edits cannot silently rewrite an earlier submission.
- Persisted-state round trips retain intended state, and displayed progress agrees
  with the underlying answers after any supported action sequence.

These remain design/test obligations. The prototype exercises them through the
tests and browser checks recorded in the [prototype guide](docs/prototype.md);
that evidence is not a guarantee for every failure mode or host integration.

## First implementation checkpoint

Prove a small end-to-end scenario: view full options, draft an answer, annotate an
option in the embedded browser, clarify in chat, return with the draft intact,
reload, and explicitly submit the entire form with one answered question and
another deliberately left blank. Verify that the socket wakes the waiting agent
and carries both outcomes, without manual transfer. Also verify that agent edits to question definitions refresh
the form while preserving draft work. Verify the host annotation workflow in the
real embedded browser, not only in a mock; it requires no clarification state in
the application.

Long-term storage, question import/update format, and handling
changed questions remain design questions. The prototype uses replaceable
implementations to make those choices concrete. Keep publishing and billing out
of this checkpoint.
