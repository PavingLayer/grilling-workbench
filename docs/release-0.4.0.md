# Grilling Workbench 0.4.0

Form submissions can now return to the same Codex desktop chat without blocking
clarification or native browser annotations. The optional adapter listens for
saved forms in the background and delivers the complete snapshot, starting a
turn when the chat is idle. No polling or scheduled monitor is needed.

- Adds the `grilling-workbench-codex` executable and companion skill. Codex
  connection details stay in this adapter; the core submission protocol remains
  host-independent.
- Adds `install-skill --skill NAME` for selecting a bundled skill. Existing
  skill directories are never overwritten by this installer.
- Preserves whole-form submission, unanswered outcomes, session binding, and
  explicit agent receipts. Host delivery never acknowledges answers automatically.
- Keeps state schema 1 and socket protocol 1 unchanged.

Install both skills for Codex:

```sh
npx skills@latest add PavingLayer/grilling-workbench --skill grilling-workbench --agent codex
npx skills@latest add PavingLayer/grilling-workbench --skill grilling-workbench-codex --agent codex
npx --yes grilling-workbench@0.4.0 --version
```

Node.js 22 or later is required. The adapter uses internal desktop IPC verified
on Linux with bundled Codex 0.153.0-alpha.5 and requires the owning desktop window
to remain open. Windows, remote tasks, and incompatible future IPC revisions are
unsupported. Other hosts can implement adapters against the same core events.

Validation: syntax checks, all 35 tests, offline-install and npx package smoke
tests, live active/idle delivery, and a user-driven annotation, clarification,
submission, and receipt round trip. See the [validation notes](validation.md)
for the evidence and remaining limits.
