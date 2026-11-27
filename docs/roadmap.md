# Roadmap

Implemented in 0.10.0: opt-in explicit local source bindings and bounded whole-file
change checks independent of verification. See [local sources](local-sources.md).

Implemented in 0.9.0: independent rule ownership/review windows and reference-bound
maintenance reports, without changing verification policy.
See [rule reviews](rule-reviews.md).

Implemented in 0.8.0: explicit current-clock verification before a supplied
command, with mandatory content/nonempty checks and preserved child results.
See [verified commands](verified-commands.md).

Implemented in 0.7.0: explicit saved-snapshot diff and guided new-project setup.
See [snapshot diff and setup](snapshot-diff-and-setup.md).

Implemented in 0.6.0: opt-in portable project IDs, explicit environment profiles,
and verification metadata reports with separately requested Git context.
See [project/profile/report guide](project-context.md).

Implemented in 0.5.0: read-only doctor, opt-in Claude advisory SessionStart adapter
and configuration snippet, host matrix and critical-action recipes.
See [lifecycle setup](lifecycle.md). Codex/Cursor adapters remain unshipped.

See the [development plan](development-plan.md) for research evidence, proposed
milestones, dependencies, pilot validation, and acceptance criteria.
The plan distinguishes implemented releases from proposed milestones and dates.

Implemented in 0.4.0: shared-lifecycle explain, opt-in retained-content v3
snapshots and field deltas, and escaped Markdown verify/explain reports.
See [the guide](explainability.md).

0.3.1 improves published-package onboarding and CLI reference accuracy, and adds
a [first-rule walkthrough](first-check.md). Verifier behavior is unchanged.

## Implemented in the initial MVP

- Versioned manifest and handoff contracts, with strict local validation.
- Deterministic verification of missing, expired, revoked, superseded,
  out-of-scope, and unknown constraint IDs.
- Text and JSON CLI output with documented exit codes.
- A fixed-clock failing and corrected demo, acceptance tests, and CI.
- A portable Claude Code/Codex adapter using the same CLI.
- Local package installation smoke testing and terminal-safe text diagnostics.

## Release operations

- Run the configured platform matrix on hosted CI before tagging a release.
- Publish the reviewed `handoff-check` package for `npx` use after npm authentication.

## End-user distribution milestone

- `init --scope <scope> --agent codex|claude|both|none` creates starter contracts,
  project config, portable skills, and managed agent instruction blocks.
- `--dry-run` previews changes. Existing inputs remain intact; conflicting skills
  or instruction markers fail before writing. `--ci` adds a pinned verification job.
- Versioned `.handoff-check.json` supplies local paths and scope; explicit verify
  flags override config. No ancestor discovery or inferred environment.
- Test packed offline npx installation and onboarding from a separate consumer
  directory on Linux, macOS, and Windows.
- Merge reviewed PRs into main after CI, prepare a GitHub release, and document
  token-free trusted publishing for subsequent npm releases.

## Following releases

Implemented in 0.3.0: active-rule counts, explicit empty-check summaries and optional
nonempty verification policy, with v1 default JSON compatibility.

Implemented in 0.2.0: revisioned v2 manifests, content-aware handoff snapshots,
canonical SHA-256 comparison, CHANGED findings, explicit --require-content,
legacy compatibility and reviewed migration guidance. No automatic baseline refresh.

- Incorporate feedback from real repositories before expanding the contract.
- Consider optional old-content storage for textual diffs in a later version.
- Consider host-specific enforcement hooks separately from the portable skill;
  neither skill discovery nor agent instructions guarantee execution.

## Outside the initial scope

- Inferring constraints from prose or agent transcripts.
- Fetching or authenticating source references.
- Editing manifests automatically or granting execution permissions.
- Hosted services, model calls, and agent-specific verification engines.
