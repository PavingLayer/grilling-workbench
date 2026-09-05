---
name: grilling-workbench
description: Present interview rounds and project decisions as local browser forms and receive whole-form submissions over a socket. Use when the user requests the workbench or a browser questionnaire, or project instructions select it as the question interface for grilling, grill-with-docs, or wayfinder. Keep reasoning and clarification in the existing chat.
---

# Grilling Workbench

Use this as the question interface for the user's current workflow. The parent
workflow chooses questions, interprets answers, owns decision records, and decides
when to finish. This skill does not start another interview or invoke a user-only
skill on its own.

Before presenting a round, read [the agent protocol](references/agent-protocol.md).
When authoring or changing questions, read [the question format](references/questions.md).

The executable is `grilling-workbench` on PATH, or
`npx --no-install grilling-workbench` for a project installation. Check `--version`;
this skill ships with package 0.2.x and socket protocol 1. If unavailable, locate
the project's configured installation. Do not fetch an unrelated same-name
registry package or silently substitute manual copy/paste.

## Essential rules

- One isolated session directory per chat round; retain its exact path in chat
  context or the workflow's handoff record. Never select another chat's session
  by recency. `init` copies definitions; edit that copy through `update`.
- Arm `wait --session DIR` before opening the form. Keep the agent's tool wait
  active. A detached process cannot independently wake an idle chat. If the host
  cannot maintain that wait, explain the missing integration rather than claiming
  automatic receipt. Do not replace it with polling or a scheduled heartbeat.
- Submission covers every question in one click. Read the immutable snapshot,
  including `not_answered`, before acknowledging its exact ID. A blank draft is
  not a user decision; a submitted blank is a decision to leave that question
  unanswered, never acceptance of a recommendation.
- Clarification, annotations, explanations, and all non-submission communication
  stay in chat. Update question definitions when useful; preserve IDs for the
  same meanings. Do not add clarification state or a review step to the app.
- Recompute the next round from actual answers. Unanswered prerequisites remain
  unresolved unless the user explicitly decides how to handle them.

For Matt Pocock's `grilling`, put the current independent decision frontier in
one form; keep dependent questions for later rounds. For `grill-with-docs`, keep
domain records under its configured rules. For `wayfinder`, the form supplies
answers to the current decision ticket; it does not become the map or close the
ticket itself. Respect the user's selected workflow and its completion criteria.
