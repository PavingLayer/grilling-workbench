Forms can now be completed with arrow keys or Vim-style shortcuts, including
question navigation, answer selection, notes, submission, history, and recovery
actions.

- Use Up/Down to focus controls, Left/Right to change questions, and Enter or
  Space to activate. Arrow navigation also works with Vim shortcuts disabled.
- Vim keys include j/k, h/l, gg/G, numbered choices, i to write, and Escape to
  return to navigation. Ctrl/Cmd+Enter submits the whole form while typing.
- A visible keyboard guide and mode indicator explain the controls. The Vim
  preference is remembered in the browser.
- Focus survives saved edits and question updates. Dialog navigation stays
  inside the dialog; text fields retain normal cursor and selection keys.
- Installation guidance now uses the Skills CLI to install the agent skill
  directly from GitHub. Bundled application commands are pinned to 0.3.0.

Requires Node.js 22 or later. No production dependencies were added. State schema
1 and socket protocol 1 are unchanged; existing drafts and submissions remain
compatible. Finish active rounds on their original application version before
upgrading.

```sh
npx --yes grilling-workbench@0.3.0 --version
```

Validation includes 27 automated tests, offline-install and npx package smoke
tests, and embedded-browser checks. The validation guide records the remaining
browser and platform coverage limits. The attached archive is the npm package
artifact.
