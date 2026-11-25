# Your first real check

Use a new disposable directory for this walkthrough. Node.js 22+ is required;
Bun, API keys, and GitHub Actions are not required. All rules below are synthetic.

## Initialize and inspect the empty starter

```sh
mkdir handoff-check-demo
cd handoff-check-demo
npx handoff-check@0.5.0 init --scope staging --agent none
npx handoff-check@0.5.0 verify --require-content
```

The starter passes with `PASS (EMPTY)` and `0 active constraints checked`.
This confirms valid inputs, not meaningful rule coverage. Adding `--require-active`
now would produce `NO_ACTIVE_CONSTRAINTS` and exit 1.

## Add one reviewed rule

Replace the starter `constraints.json` with this exact JSON:

```json
{
  "schemaVersion": 2,
  "constraints": [
    {
      "id": "MIGRATION-REVIEW",
      "scope": "staging",
      "revision": 1,
      "description": "Require review before applying staging migrations",
      "source": "docs/migration-policy.md"
    }
  ]
}
```

`source` is review metadata; this synthetic path need not exist. Verification
does not fetch it or check the contents of a referenced document.

Before capturing a baseline, run:

```sh
npx handoff-check@0.5.0 verify --require-content --require-active
```

Expect `MISSING MIGRATION-REVIEW`, one active constraint, and exit 1. The old
starter handoff does not include the new rule yet.

## Capture and verify a reviewed baseline

```sh
npx handoff-check@0.5.0 snapshot --task "Review staging migration" --output handoff.reviewed.json
npx handoff-check@0.5.0 verify --handoff handoff.reviewed.json --require-content --require-active
```

Review the generated file before relying on it. The verification command should
report `PASS`, `1 active constraints checked`, `0 findings`, and exit 0.
Snapshot refuses to overwrite an existing output path; use a new filename when
deliberately capturing another reviewed baseline.

This example passes the baseline explicitly. For subsequent agent/CI use, review
and edit `.handoff-check.json` so `handoff` points to `handoff.reviewed.json`.
Otherwise commands without `--handoff` still use the original starter file.

## Detect a rule change

In `constraints.json`, change the description to
`Require two reviewers before applying staging migrations`. Leave the saved
handoff unchanged, then run:

```sh
npx handoff-check@0.5.0 verify --handoff handoff.reviewed.json --require-content --require-active --format json
```

Expect `status: "mismatch"`, `activeConstraintCount: 1`, a `CHANGED` finding, and
exit 1. The content hash catches the edit even if revision remains 1. For a
deliberate policy update, also increment its revision during review.

Do not recapture a baseline just to make a resumed check pass. Review the changed
rule and resolve affected work first; only then deliberately capture and adopt a
new baseline. Default v2 snapshots detect changes without retaining old descriptions.
For opt-in v3 field-level diffs and Markdown reports, see the
[0.4 guide](explainability.md). Do not recapture a resumed baseline to add retention.

## Interpret the result correctly

- Exit 0: the declared rules match for the selected scope/time and requested policies.
- Exit 1: rule mismatch or an empty set rejected by `--require-active`.
- Exit 2: invalid arguments, invalid data, or unreadable inputs.

A pass does not prove the agent obeyed the rule or grant permission to apply a
migration. Installing a skill does not guarantee it runs; generated CI checks
committed inputs when its workflow executes, not every agent action.
