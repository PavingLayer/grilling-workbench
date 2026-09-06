# Use the workbench with your interview skills

The workbench lets you answer interview rounds in a browser while reasoning and
follow-up stay in the same chat. Once installed, it should be selected whenever
the agent interviews you. You can simply say “grill me” or invoke your usual
interview skill; you do not need to request a browser form.

## Set up the project once

You need Node.js 22 or later, and an agent that can open a browser and keep a local
command running while waiting for your answers. The browser, workbench server,
and agent must run on the same computer.

From the project where you want to use it:

```sh
npx skills@latest add PavingLayer/grilling-workbench \
  --skill grilling-workbench --agent codex
```

The [Skills CLI](https://github.com/vercel-labs/skills) fetches the skill from GitHub
and installs the instructions that teach the agent when and how to use the
workbench. For Codex, it creates `.agents/skills/grilling-workbench` and records the
source in `skills-lock.json`. Omit `--agent codex` to choose another agent.
No `package.json`, project dependency, or global installation is required,
including in non-Node projects.

`@latest` applies to the skill installer. The skill pins application commands to
`grilling-workbench@0.2.0`; npm downloads that application into its cache when the
agent first runs it. Keep the same exact application version throughout a round.

For exact-release or offline installation, source development, or upgrades, use the
[deployment guide](deployment.md). Keep your existing interview skills installed;
Matt Pocock's repository has its own [installation instructions](https://github.com/mattpocock/skills).

## Start your usual interview

For example, invoke `grill-me` or say:

> Grill me about the checkout design.

The expected flow is:

1. The interview skill chooses the next round of questions.
2. The agent starts a workbench session, connects its submission listener, and
   opens the form in the browser.
3. You answer, revisit questions as needed, and click **Submit form** once.
4. The agent receives the complete submitted round and continues the same chat.

There is no separate review step or manual copy/paste. You may leave a question
blank: submission reports that as `not_answered`, so the agent knows you chose
not to answer it. That does not settle the underlying decision.

For explanations or changes to a question, use chat or the browser's native
Annotate/Quick Annotate features. The agent can revise the form while preserving
your draft. The app itself only handles answering and submitting questions.

The agent must remain actively waiting on the listener to continue immediately.
This package does not start new turns in an idle chat. Agents should read the
[operating protocol](../skills/grilling-workbench/references/agent-protocol.md)
before presenting questions; it covers the listener, receipts, and interruptions.
The [question format](../skills/grilling-workbench/references/questions.md) is the
reference for authoring or updating a round.

## How it fits the existing workflow

The workbench handles question presentation and answer delivery. Your chosen skill
still decides what to ask, interprets the answers, updates project records, and
determines when the interview is complete.

| Workflow | How to combine it with the workbench |
| --- | --- |
| [`grilling`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/productivity/grilling/SKILL.md) / `grill-me` | Use one form for the current round of independent questions. Questions that depend on unresolved answers belong in a later round. |
| [`grill-with-docs`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/grill-with-docs/SKILL.md) | Use the same form interface while the existing interview and domain-modeling skills maintain the project documents. |
| [`wayfinder`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/wayfinder/SKILL.md) | Use forms during interviews about the current decision ticket. Keep the map, ticket ownership, dependencies, and resolution records in Wayfinder. |
| [`setup-matt-pocock-skills`](https://github.com/mattpocock/skills/blob/3cca18b368ae95cdbdebbff572ccafa662551015/skills/engineering/setup-matt-pocock-skills/SKILL.md) | Keep the tracker and domain-document configuration it establishes. Installing the workbench does not replace that configuration or invoke setup. |

A submitted form supplies answers; it does not automatically close tickets or
approve further work. Keep canonical decisions in the configured documents or
tracker, using submission and question IDs for attribution. Raw session files
remain private by default.

These integration recommendations were reviewed against upstream revision
`3cca18b368ae95cdbdebbff572ccafa662551015` on September 5, 2026. Check the actual
installed skills when upgrading; there is no need to patch their bodies to use
the workbench.

## If the agent does not use the workbench

First check whether `grilling-workbench` appears in the agent's available skills.
In Codex, that list combines applicable project skills, user skills, administrator
and system skills, and enabled plugin skills. It does not automatically include
local skills from unrelated projects. The setup command above adds the workbench
at the current project's `.agents/skills/grilling-workbench` path.

Codex normally detects new skills automatically. If it is missing, restart Codex
and check the installed path. If it appears more than once, inspect the source
paths for duplicate user/project installations. [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills)

If the skill is listed but not selected during an interview, explicitly invoke
`$grilling-workbench` once to check that it can run. This is a troubleshooting step,
not the expected everyday workflow. Automatic selection depends on the agent
matching the interview to the skill description; it is not an application hook.
[How Codex selects skills](https://learn.chatgpt.com/docs/build-skills#how-chatgpt-and-codex-use-skills)

A short project instruction can reinforce the trigger. Merge this into the
project's existing AGENTS.md or equivalent instruction file, preserving its other
rules. It is optional; the skill already defines the interview trigger.

```markdown
Whenever interviewing the user, use the grilling-workbench skill at
`.agents/skills/grilling-workbench/SKILL.md`. Apply it alongside the current
interview workflow, including grill-me, without requiring a request for a browser
form. The command is `npx --yes grilling-workbench@0.2.0`.

Read the skill's operating protocol before presenting questions. Keep reasoning,
clarification, and decision records in the existing workflow. Respect an explicit
user request for another interface.
```

The installer does not edit project instructions automatically. Adjust the command
in the snippet if you explicitly configure a local or global installation.

## Check answer delivery in your agent

Try a throwaway two-question round. Answer one question, leave the other blank,
and submit. The agent should receive both outcomes and continue without another
chat message. Its listener should already be waiting before the form opens.

If the page stays on “Waiting for the agent,” inspect the listener process and
follow the [reconnection and receipt instructions](../skills/grilling-workbench/references/agent-protocol.md#definitions-and-interruptions).
Do not replace the listener with repeated status checks or ask the user to paste
answers. If the agent application cannot maintain an active tool wait, that
integration needs support before immediate continuation can work.

The package tests verify installation, socket delivery, receipts, and recovery.
Automatic skill selection in a fresh agent installation still needs this real
workflow check. Test ordinary interview requests without mentioning the browser;
explanations about an existing option should continue in chat.

## Share it with another project

Share [PavingLayer/grilling-workbench](https://github.com/PavingLayer/grilling-workbench)
and repeat the Skills CLI setup above. The skill supplies the pinned application
command; browser and command-execution tools must be supplied by the agent host.

The bundled npm `install-skill` command remains an alternative when you want the
skill from an exact application release or need an offline archive. See
[distribution and installation](deployment.md#distribution-and-installation).
