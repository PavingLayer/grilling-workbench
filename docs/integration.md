# Project integration and discovery

Use two separately installable parts: the executable owns local forms and socket
delivery; the skill tells an agent when and how to use it. The project may make
that interface a standing preference. Neither part rewrites the interview skill
or becomes the source of project decisions.

## Discovery needs installation, routing, and instructions

A repository published on the internet is not automatically visible to an agent.
The skill must first be installed into a location the agent application scans.
For the current task, Codex combines applicable project skills (`.agents/skills`
from the working directory up to the repository root), user skills
(`~/.agents/skills`), administrator skills, and bundled system skills. Enabled
plugins can also contribute skills. This does not include every other project's
local skills. Here, “available skills” means this combined set for the current task.
Codex initially reads names and descriptions, then loads the full skill when
selected. Explicit invocation and description-based matching are supported.
Large skill lists can shorten or omit descriptions, so put the main trigger first.
[Official skill documentation](https://learn.chatgpt.com/docs/build-skills)

The bundled [skill](../skills/grilling-workbench/SKILL.md) describes browser
questionnaires, workbench requests, and projects that choose this interface for
interview rounds. Its Codex metadata permits implicit invocation. Its instructions
link to the socket protocol and question format, both copied by the installer.
Installing the CLI alone does not install the skill; installing the skill alone
does not provide Node, the executable, browser control, or a persistent tool wait.

After package installation:

```sh
npx --no-install grilling-workbench install-skill
```

Codex detects installed skill changes automatically; restart Codex if the new
skill does not appear. Check its visible name and source path in the skill picker;
avoid duplicate user/project copies of the same
name. Explicitly invoke `$grilling-workbench` in Codex (or the host's skill picker)
for a first trial. Automatic selection is useful but is not a deterministic
application hook. A project instruction makes the intended preference clearer.

## Project preference

When a project chooses this workflow, merge the following small section into its
existing AGENTS.md or equivalent host instruction file. Preserve surrounding
instructions and the tracker/domain configuration already present. Replace the
command if the project uses a global executable. This repository ships the text;
its installer does not edit another project's instructions automatically.

```markdown
## Question interface

For project interview rounds, use the installed grilling-workbench skill at
`.agents/skills/grilling-workbench/SKILL.md` as the question interface. The command
is `npx --no-install grilling-workbench`. Read the skill before presenting a round
and arm its socket listener before opening the form. Continue the current chat
when the submitted snapshot arrives; no manual transfer or polling monitor.

Keep question selection, reasoning, decision records, and completion criteria in
the user's chosen workflow. Clarification stays in chat. Submitted `not_answered`
outcomes do not settle their underlying decisions. Use another interface when
the user explicitly requests it. If this host cannot keep an active tool wait,
explain that limitation rather than claiming automatic delivery.
```

This opt-in instruction selects presentation. It does not grant permission for
issue creation, publishing, execution, or starting a different interview workflow.

## Alongside Matt Pocock's skills

Compatibility was reviewed against upstream revision
`3cca18b368ae95cdbdebbff572ccafa662551015` on September 5, 2026. These
are composition recommendations for the inspected versions, not a promise that
upstream interfaces never change. Read the actual installed skill when using it.

| Existing workflow | Workbench's role | Workflow retains |
| --- | --- | --- |
| `grilling` / `grill-me` | Present one current independent decision frontier as a form. | Dependency reasoning, subsequent rounds, interpretation, and completion. |
| `grill-with-docs` | Supply submitted answers through that same interface. | `grilling` plus `domain-modeling`, including its documentation rules. |
| `wayfinder` | Supply answers while discussing the current decision ticket. | Map, ticket claims, dependencies, resolution records, and planning boundaries. |
| `setup-matt-pocock-skills` | No automatic invocation or configuration replacement. | The project's tracker, domain-document layout, and related instructions. |

Upstream `grilling` batches currently independent decisions and waits before
recomputing the next round. This maps to one form per round, with dependent
questions held for later. [Grilling source](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grilling/SKILL.md)

`grill-with-docs` composes the interview with domain modeling. Keep that
composition; only its presentation changes. [Grill with docs source](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/grill-with-docs/SKILL.md)

Wayfinder's map and decision tickets remain canonical, with planning as its default
scope. A form submission is evidence for the conversation, not automatic ticket
resolution. [Wayfinder source](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wayfinder/SKILL.md)

Upstream setup writes tracker/domain guidance through the project's existing
instruction file. Add the workbench preference alongside it; do not overwrite
that configuration or patch installed upstream skill bodies. [Setup source](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/setup-matt-pocock-skills/SKILL.md)

A `not_answered` item may leave a prerequisite open. The agent records that outcome
and discusses any necessary next step in chat; it does not infer agreement, choose
its recommendation, or silently close the issue. Canonical decisions belong in
the configured documents/tickets, with the submission ID and relevant question ID
for attribution. Session files contain raw input and should stay private by default.

Upstream documents `npx skills@latest add mattpocock/skills` for installing its
skills. Install/configure only the workflows the project intends to use; this
adapter does not automatically invoke user-only skills. [Upstream repository](https://github.com/mattpocock/skills)

## Publishing the skill

For local adoption now, use the archive's tested skill installer. For a future
repository release, the existing `skills/grilling-workbench/SKILL.md` layout is
recognized by the Skills CLI. Once an actual repository URL and release are
chosen, users can install that skill with `skills add <repository> --skill
grilling-workbench`. The same CLI supports local source paths for development.
[Skills CLI source](https://github.com/vercel-labs/skills#skill-discovery)

Release the executable and skill together at matching versions, and document the
actual package location. A skill listing is a distribution path, not a substitute
for the executable. Public npm publication still needs an owner/package name,
license decision, and release destination; none is invented or published here.
A native host plugin is a possible later distribution wrapper if desired, not a
requirement for the selected project-local CLI deployment.

## Verify the integration in a target host

The package smoke test verifies executable behavior and that skill files survive
installation. Skill selection and host event delivery need a real host trial:

1. Confirm the installed skill appears with the intended path and version context.
2. Explicitly invoke it with a throwaway two-question form; observe a listener
   ready before the browser opens.
3. Answer one question, leave the other blank, and submit once. The agent should
   receive both outcomes and respond without another chat message or paste.
4. Test an implicit request such as “Use the workbench for the next design round.”
   Under the project preference, also test “Grill me about checkout.” Confirm the
   active interview skill still owns reasoning and records.
5. Test boundaries: “Explain this option” should stay in chat; “Use ordinary chat
   questions this time” should respect the user's interface choice.
6. Interrupt/reconnect the listener before receipt; confirm one saved snapshot
   replays. After receipt, confirm it is not applied twice to decision records.

These are acceptance scenarios, not claims that every model or host has already
passed them. The native browser annotation workflow was exercised during UI
iteration; autonomous selection in a fresh installed host remains to be verified.
