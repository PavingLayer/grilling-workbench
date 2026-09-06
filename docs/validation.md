# Validation and known limits

This records what has been checked for the implemented workbench. For normal use,
start with the [integration guide](integration.md); for installation and recovery,
use the [deployment guide](deployment.md).

## Automated checks

The 0.2.0 release checks passed locally on Linux with Node.js 22.22.2 on September
6, 2026 (UTC): syntax validation, 18 automated tests, and both installed-package
and `npx` smoke tests. CI runs the same checks on Node 22 and 24; see
[GitHub Actions](https://github.com/PavingLayer/grilling-workbench/actions/workflows/verify.yml)
for the hosted results associated with a release commit.

The automated tests cover:

- Unanswered defaults, recommendation labels, and 1,000 generated action histories
  checked against an independent model. The default seed is `20260905`;
  `FC_SEED` and `FC_PATH` reproduce other generated cases.
- Complete immutable submission snapshots, including submitted blanks; rejection
  of partial forms and stale snapshots; and idempotent retries.
- Draft preservation through definition changes, conflicts, failed writes, and
  restart. Corrupt saved data is retained rather than reset.
- Socket completion only after persistence. Tests deliberately hold the storage
  write open, then check delivery, reconnect replay, and receipt failure recovery.
- Session ownership, listener credentials, startup failure cleanup, port reuse,
  and rejection of unrelated web origins and private-file requests.

The package smoke test packs the actual release and exercises it twice: installed
offline in an unrelated project, and through `npx` from an isolated cache in a
project without package files or dependencies. Both modes verify bundled skill
installation without overwriting an existing copy, two isolated sessions, served
browser assets, whole-form delivery, acknowledgments, definition updates, restart,
and the source-checkout demo entrypoint. The `npx` test uses the local archive,
so registry publication and a fresh registry download are separate release checks.

The recommended Skills CLI installation was separately checked on September 6,
2026 (UTC), with Skills CLI 1.5.23 and Node.js 22.22.2. In a clean temporary project,
`npx skills@latest add PavingLayer/grilling-workbench --skill grilling-workbench --agent codex`
was run with confirmation accepted through `--yes`. It installed the skill and
both reference files matching the repository, created `skills-lock.json`, and
added no `package.json`, `package-lock.json`, or `node_modules`. The installed
skill retained its `grilling-workbench@0.2.0` application pin. This check verifies
installation, not automatic selection by an agent.

## Embedded-browser checks

The implemented interface has been checked in the embedded browser for:

- A 20-question form at 808×1139, with independently scrolling navigation and
  question content, a visible footer, and no horizontal overflow.
- Narrow layouts at 390×844 and 320×740, with the question picker, footer actions,
  draft persistence after reload, and submission history available.
- Direct submission while draft saves are deliberately delayed. Submit remains
  enabled while typing and sends the latest text without a review step.
- Submission containing one answer and two blanks, received over TCP with both
  `not_answered` outcomes. Recording receipt updates the page's delivery status.
- Definition refresh, preserved draft text, recoverable save failures, and restart.

Native browser annotations were received in chat during UI iteration. After the
0.2.0 runtime upgrade, the existing preview still displayed the user's submitted
answers; its saved state and receipt files matched their pre-upgrade backups.

## Limits of this evidence

An actively waiting listener receives submissions immediately. The package does
not provide an idle-chat wakeup bridge. One user submission was captured over TCP
while the agent was idle, then read only after another chat message; that is not
evidence of automatic continuation in an idle chat.

The skill now directs agents to use the workbench for all interviews. Metadata
validation checks its structure; it does not prove that every model will select
it correctly. Automatic discovery and continuation in a fresh agent installation
still need the [target-agent checks](integration.md#check-answer-delivery-in-your-agent).

Screen-reader testing and a dedicated option-targeted annotation/clarification
round trip remain outstanding. Other operating systems, network filesystems,
device loss, and power-loss durability have not been release-tested. Exactly-once
chat replies across crashes are not guaranteed; the agent protocol documents
receipt and downstream-work recovery separately.

## Run the checks

From the source repository:

```sh
npm ci
npm run check
npm test
npm run test:package
```

Integration tests require permission to bind local HTTP and TCP sockets. Browser
and target-agent checks are separate from these automated commands.
