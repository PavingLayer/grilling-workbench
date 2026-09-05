# Question definitions

Definitions are UTF-8 JSON. The CLI validates them using the same domain validator
as the server. Keep the input below 1 MB and rounds small enough to read usefully;
the HTTP action limit is 2 MB including all question and answer text.

```json
{
  "id": "checkout-design-r01",
  "title": "Checkout decisions",
  "description": "Choose the behavior for the first release.",
  "navigationLabels": { "guests": "Guest checkout", "constraints": "Constraints" },
  "questions": [
    {
      "id": "guests",
      "revision": 1,
      "title": "Can a customer check out without an account?",
      "context": "This determines whether account creation blocks a purchase.",
      "type": "single",
      "options": [
        {
          "id": "allow",
          "label": "Allow guest checkout",
          "description": "Collect contact and delivery details without requiring registration.",
          "benefit": "Fewer steps before placing an order.",
          "tradeoff": "Returning guests need an order link to track their purchase.",
          "recommended": true
        },
        {
          "id": "account",
          "label": "Require an account",
          "description": "Require registration or sign-in before checkout.",
          "benefit": "Every order belongs to a persistent customer account.",
          "tradeoff": "Adds a step before purchasing."
        }
      ]
    },
    {
      "id": "constraints",
      "revision": 1,
      "title": "Which constraints must the first release respect?",
      "context": "Include commitments the team has already made.",
      "type": "text",
      "options": []
    }
  ]
}
```

## Contract

- Form: `id`, nonblank `title`, `description`, and 1–100 `questions`.
- Question: `id`, positive integer `revision`, nonblank `title`, `context`, `type`,
  `options`. Types: `single`, `multiple`, `text`.
- Choice questions have 1–100 options. Text questions have `options: []`.
- Option: `id`, `label`, `description`, `benefit`, `tradeoff`; optional boolean
  `recommended`. Every field is plain text. Rendered content is escaped.
- All answer types allow written text. Choice plus text is a single answer.
  A recommendation is only a label and never preselects an option.
- IDs: 1–100 ASCII letters/digits/underscores/hyphens, starting with a letter or
  digit; `constructor`, `prototype`, and `__proto__` are reserved. Question IDs
  are unique within the form; option IDs within their question.
- General text fields and written answers have a 20,000-character limit each.
  Optional `navigationLabels` maps existing question IDs to nonblank labels of at
  most 80 characters. Those labels affect navigation only.

Preserve IDs for the same question/option; increment revision when meaning
changes. Changes to wording are detected even without a revision bump. Do not
silently reuse an option ID for a different decision. `update` keeps the form ID;
use a new session and form ID for a new round.

Answered questions whose definitions change retain their earlier draft and need
the user to adopt/edit the new wording before submitting. Removed options cannot
remain selected under new definitions. Deleted questions' drafts remain stored
outside the current form. Earlier submission snapshots never change.

Only an explicit whole-form submit creates outcomes. Nonempty selected options
or non-whitespace text gives `answered`; otherwise `not_answered`. The latter
communicates the user's decision not to provide an answer at submission time;
it does not settle that underlying project decision. There are no partial
submissions, required answers, clarification markers, or review screen.
