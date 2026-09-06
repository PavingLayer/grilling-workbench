---
name: grilling-workbench
description: Use whenever the agent interviews the user, including grill-me, grilling, grill-with-docs, wayfinder, requirements gathering, and decision interviews. Automatically present question rounds in the workbench and receive submitted answers in chat.
---

# Grilling Workbench

Apply this skill whenever conducting an interview, whether the interview starts
from the user's request, another skill, or the ongoing task. Select the workbench
before presenting the interview questions; do not require the user to request a
browser form or the project to opt in separately. Respect an explicit user request
for another interface.

Use this as the question interface for the user's current workflow. The parent
workflow chooses questions, interprets answers, owns decision records, and decides
when to finish. This skill does not start another interview or invoke a user-only
skill on its own.

Before presenting a round, read [the agent protocol](references/agent-protocol.md).
When authoring or changing questions, read [the question format](references/questions.md).

Run `npx --yes grilling-workbench@0.2.0` for every CLI command. This uses the
public npm package maintained at `https://github.com/PavingLayer/grilling-workbench`
without adding a project dependency. Check `--version`; this skill ships with
package 0.2.0 and socket protocol 1. Keep the exact version throughout a round;
do not use `@latest` or an unversioned command. An explicitly configured local or
global installation is also supported when its version matches. If installation
or registry access fails, report it rather than substituting manual copy/paste.

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
