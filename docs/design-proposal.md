# First checkpoint design proposal

> Historical proposal: the user subsequently selected UI direction B and required
> whole-form submission, explicit “Not answered” outcomes for blanks, and immediate
> socket delivery to the waiting chat agent. Sections below describing partial
> submission or manual copying are superseded. Follow [README.md](../README.md),
> [the prototype guide](prototype.md), and [the monitor protocol](agent-monitor.md).

Status: original design draft, not accepted requirements. A local prototype now
implements provisional choices documented in the [prototype guide](prototype.md).
The [README](../README.md) remains the source of agreed requirements. Only explicit
user decisions can settle the choices below.

## Agreed clarification boundary

The user clarified that this application is a simple question-answering UI.
Clarification happens through the host's native Annotate or Quick Annotate
features and the existing chat. The agent explains or edits question definitions;
the form refreshes those definitions while preserving draft work. The app does
not track clarification, mirror comments, or require the user to mark a doubt
resolved before submitting an answer. The state proposal below follows that
decision; its remaining choices are still proposals.

## Separate working answers from submitted decisions

Proposed state has three independent parts:

| Part | Contents | Purpose |
| --- | --- | --- |
| Question definition | Stable question and option IDs, question revision, complete wording, descriptions, trade-offs, recommendation label | Identify exactly what the user saw. |
| Working answer | Draft choice and/or text, draft revision, explicit deferral state | Retain work while answering or postponing a decision. |
| Submission | Stable submission ID, immutable copies of the reviewed question definitions and selected answers | Preserve precisely what the user explicitly submitted. |

The supported answer types (single choice, multiple choice, free text, or a
combination) still need a decision. The state design should not silently limit
all questions to one selected option.

A working answer can have a draft and be deferred at the same time. Changing
deferral state should preserve the draft. A prior submission remains historical
evidence if the user later edits their working answer. There is no clarification
field or transition.

Proposed presentation:

- Show an answer indicator: unanswered, draft, or submitted for the current
  question revision and answer content.
- Show deferral alongside the retained draft.
- Show a later edit as a draft with a link to the earlier submission.
- Count current submitted questions once. Pending is the remaining questions;
  counts for drafts and deferral may overlap and are labeled as
  such. Seeing a question is never answering it.

These are proposed display rules, including the definition of pending. They are
not yet settled product decisions.

## Review and explicit partial submission

Proposed sequence:

1. The user drafts answers without submitting anything.
2. The user explicitly chooses which answers to include in a review. The review
   starts with no answers selected. Answers not included remain pending. There
   is no separate marker-clearing step: explicitly submitting a deferred answer
   ends its current deferral. Native annotations have no effect on eligibility.
3. Review shows the exact selected question revisions and answer contents,
   including user text. It also names the questions left pending.
4. A change to an included draft or its question definition invalidates the
   review; confirmation requires reviewing the updated contents.
5. Explicit confirmation creates an immutable submission for just that reviewed
   selection. Repeating confirmation for the same review reuses its submission
   ID instead of creating another decision.
6. Persist the submission before offering its handoff. Display save state and
   handoff state separately from the fact that the user confirmed the answers.

If saving fails, preserve the confirmed snapshot and drafts in memory, visibly
report that they are not saved, and offer retry or recovery export. Do not offer
normal handoff until persistence succeeds. Recovery after closing the browser
cannot be promised if no durable write or recovery export succeeded.

If handoff fails, retain the saved submission and retry the same ID and contents.
Later drafts must not change its payload. The application can make its own
submission records and exports idempotent; preventing duplicate interpretation
in chat requires a receiving convention or integration and must not be claimed
as an automatic host guarantee.

## Decisions to resolve

| Topic | Proposed first checkpoint choice | Trade-off / alternative | Status |
| --- | --- | --- | --- |
| Storage | A small local server saves runtime files inside this repository, excluded from Git | Survives browser-data clearing and supports inspection and backup; requires server lifecycle and reliable file writes. Browser storage is simpler but tied to the browser profile and app origin. | Asked; no answer recorded |
| Question input | A versioned local JSON document that the agent can edit and the workbench validates | Definition edits refresh the form as agreed; JSON is a proposed format. Exact schema and refresh mechanism remain open. | Format proposed only |
| Chat handoff | Copy a human-readable submission containing stable IDs and exact submitted decisions; user pastes it into the existing chat | Small integration surface, but copying does not prove delivery or acceptance. A saved submission file that chat reads is an alternative. | Proposed only |
| Changed questions | Preserve history and the old draft, show the change, and require explicit reconfirmation against the new version | Avoids treating an answer to old wording as consent to new wording; adds a review step. Migration details remain open. | Proposed only |
| Answer types | Support the types needed by the initial interview examples | Needs explicit examples before constraining the schema. | Open |

No framework, storage library, testing library, or host integration beyond the
README boundary is selected by this proposal. Resolving one row does not approve
the other rows or the proposed state and interaction rules.

## Independently testable transitions

Proposed core interface: a pure transition function takes state and an explicit
action and returns new state plus requested effects. It performs no browser,
filesystem, clock, random-ID, clipboard, or model calls. IDs and times are inputs.
Adapters execute effects and report success or failure with operation IDs.

Actions cover draft edits, deferral changes, review selection, confirmation,
definition updates, persistence results, handoff results, and restore. Navigation
and browser annotation activity cannot invoke confirmation as a side effect.
An old save acknowledgement cannot mark a newer edit saved. Restore validates
schema and version references; invalid data produces a recovery state rather
than silently replacing saved work with an empty questionnaire.

Generated action-sequence tests should use a small independent reference model
and check invariants after every action, rather than duplicate the transition
implementation. Include cleared drafts, multiple questions, stale results,
retries, invalid actions, and question revisions. Record seeds and minimized
failing sequences so failures can be reproduced.

| Property | Useful generated counterexample |
| --- | --- |
| No implicit consent | Any sequence without explicit confirmation produces no new submitted decisions. |
| Partial submission isolation | Confirming question A changes neither B's working answer nor B's submission history. |
| Draft retention | Changing deferral state or refreshing unchanged question definitions preserves answer contents. |
| Exact review | Editing an included answer or definition after review prevents confirming the stale review. |
| Immutable attribution | Editing or replacing a question never changes an existing submitted snapshot. |
| Idempotent local submission | Repeated confirmation or handoff retry for the same submission creates no extra local decision. |
| Honest persistence | A failed write or stale acknowledgement cannot report the current state as saved. |
| Restore consistency | A successful persisted-state round trip preserves drafts, deferral state, snapshots, and derived progress. |
| Honest progress | Display counts agree with independently derived state after every supported action. |

Persistence integration tests should exercise interrupted writes, corrupt input,
and conflicting edits from two open tabs as applicable to the selected storage.
Handoff tests should verify the exact payload, omitted pending drafts, failure,
and retry behavior. A deferral, if reported at all, must be explicitly identified
as pending rather than placed among submitted decisions.

## Real embedded-browser checkpoint

Use a clearly labeled demonstration questionnaire, unrelated to Inventor and
separate from this project's actual design decisions. Start with at least two
unanswered questions, full option descriptions, and recommendation labels that
select nothing.

1. Draft an answer to A. Verify the save feedback.
2. Use the host's annotation mode to comment on one of A's option descriptions.
   Verify that the comment identifies that option, not merely the whole page.
3. Share the comment in this existing chat and clarify it without submitting an
   answer or changing any form status. The agent can explain in chat or edit a
   question definition. The comment must come from the user; do not fabricate
   user intent.
4. Return to the same questionnaire, navigate, and reload. Verify the retained
   draft; no answer has been submitted. Also exercise an agent definition edit
   and verify the page refreshes with the new content while retaining draft work,
   subject to the changed-question policy once that policy is decided.
5. Explicitly review and submit only A. Verify the precise snapshot and handoff
   content while B remains pending.
6. Edit A again and retry the earlier handoff. Verify the earlier snapshot stays
   unchanged and B remains pending.

Record actual observations and any failed or unavailable steps. Ordinary browser
automation may cover app interactions but cannot substitute for the host-comment
round trip. The user's native annotation on the separate log-analysis page
demonstrates the intended comment-to-chat interaction. It does not verify this
workbench's draft retention, definition refresh, or submission behavior. Those
app interactions have since been checked in the embedded browser, as recorded in
the [prototype guide](prototype.md). A user-authored native annotation from this
workbench and its clarification in chat remain the outstanding manual step.

The official [Browser documentation](https://learn.chatgpt.com/docs/browser),
checked September 5, 2026, describes local web-app previews and annotation by
selecting an element or area, saving a comment, then sending a chat message. It
also describes the embedded browser's separate profile. That page does not
establish a two-way application-state API for comments. This proposal therefore
does not assume one. Documentation review is not verification on this host.
