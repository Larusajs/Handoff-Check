# Changelog

## 0.8.0

- Add run to verify current content-aware, nonempty constraints before starting an explicit command.
- Preserve config/profile/project/scope selection using the existing pure verifier.
- Require an explicit argv separator, pass arguments without an implicit shell, and inherit process streams/cwd/environment.
- Keep wrapper diagnostics on stderr and preserve child exit codes with direct-child signal forwarding.
- Refuse nonregular run inputs and bound stalled asynchronous preflight reads without limiting command runtime.
- Preserve existing verify, snapshot, setup, diff and lifecycle contracts; never refresh baselines automatically.

## 0.7.0

- Add explicit two-snapshot diff with added, removed, changed and unchanged counts.
- Compare content-aware unbound v2/v3 and bound v4 snapshots with strict scope/project matching.
- Show typed field differences when both snapshots retain content; preserve hash-only comparison.
- Add terminal-only guided setup with explicit project/environments and a real global rule.
- Preview exact new project-bound files and retained baselines before explicit adoption; refuse overwrites.
- Preserve existing verification, init, profile and lifecycle contracts without automatic migration.

## 0.6.0

- Add opt-in manifest v3/handoff v4 portable project binding with strict matching.
- Add config v2 named environment profiles selected only by explicit --profile.
- Add optional verification report wrappers with exact parsed-input/config byte digests.
- Add separately requested, bounded read-only Git worktree/commit/branch context.
- Share profile/binding semantics with doctor and the advisory Claude adapter.
- Preserve old unbound contracts and default outputs; no automatic migration or baseline refresh.

## 0.5.0

- Add read-only doctor diagnostics for project inputs, versions, paths and integrations.
- Add stdout-only hook-config for explicit, non-overwriting Claude SessionStart setup.
- Add a bounded local advisory lifecycle adapter using the existing verifier.
- Document host capabilities, local-package prerequisites and fresh critical-action checks.
- Preserve verify/snapshot/explain contracts; never automatically refresh baselines.

## 0.4.0

- Add manifest-only explain in text, JSON and Markdown using verifier lifecycle decisions.
- Add opt-in snapshot --include-content with strictly validated retained-content v3 handoffs.
- Show ordered field-level before/after changes for active CHANGED rules in v3 results.
- Add Markdown verification reports with scope/time, count, tracking, policies and findings.
- Preserve v1/v2 JSON contracts, default v2 snapshots and read-only verification.
- Escape untrusted Markdown structure/HTML and terminal formatting controls.

## 0.3.1

- Replace obsolete pre-publication onboarding instructions with registry usage.
- Document all commands, verification policies, and rule/policy exit semantics.
- Add a reproducible first-rule walkthrough with a passing snapshot and CHANGED failure.
- Record the research-backed development plan with priorities and acceptance gates.
- Keep verifier behavior and input/output contracts unchanged.

## 0.3.0

- Show the expected active-rule count in every text verification summary.
- Mark valid zero-rule checks as PASS (EMPTY), with an explicit scope/time notice.
- Add activeConstraintCount to v2 JSON while preserving legacy default JSON shape.
- Add opt-in --require-active with a global NO_ACTIVE_CONSTRAINTS finding and exit 1.

## 0.2.0

- Detect same-ID rule edits through revision and canonical SHA-256 references.
- Add v2 manifest/handoff schemas and CHANGED findings with expected/reported data.
- Add snapshot capture with exclusive new-file output and explicit scope/time.
- Preserve legacy v1 ID checks; add --require-content for explicit enforcement.
- Use v2 starters and content-aware agent/CI guidance with a reviewed migration path.

## 0.1.0

- Establish English contributor and coding-agent guidance and project policies.
- Add versioned local manifest and handoff contracts with strict validation.
- Verify missing, expired, revoked, superseded, out-of-scope, and unknown IDs.
- Provide text and JSON output, fixed-clock evaluation, and documented exit codes.
- Add reproducible failing/corrected demos and automated checks.
- Add a portable Claude Code/Codex skill and agent installation guidance.
- Escape terminal control characters in text diagnostics.
- Add project initialization, agent selection, managed instructions, dry-run preview,
  optional CI setup, project configuration, and packed npx onboarding checks.
