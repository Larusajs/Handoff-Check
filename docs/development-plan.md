# Development plan

Status: 0.3.1 onboarding, 0.4 explainability and 0.5 diagnostics/lifecycle implemented;
0.6 project/profile/report support is also implemented; later milestones proposed.
Research reviewed: 2026-11-24. Version labels below are targets, not release promises.

## Product direction

Make it clear and repeatable that current declared constraints were checked for
the intended project, scope, and time before a coding agent resumes affected work.
Keep the verifier local, deterministic, read-only, and independent of a model or
agent host. A verified declaration does not prove behavioral compliance.

## Evidence and confidence

Public issue reports are qualitative evidence, not prevalence measurements or
proof that every current version has the reported defect. Closed/duplicate reports
remain historical evidence only. Proposed features below are product hypotheses.

| Signal                                                                             | Primary source                                                                                                                                 | Implication                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Compaction can lose behavioral instructions; historical report closed as duplicate | [Claude Code #4517](https://github.com/anthropics/claude-code/issues/4517)                                                                     | Resume checks should not depend only on an agent remembering a skill.                    |
| Long-running agents lose continuity and can declare completion prematurely         | [Anthropic: effective harnesses](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)                               | Preserve explicit artifacts and distinguish declarations from verified execution.        |
| Current instructions may compete with stale memory                                 | [Codex #39223](https://github.com/openai/codex/issues/39223)                                                                                   | Explain changes; do not claim that detecting stale declarations ensures model adherence. |
| Worktree sessions can lack skills/rules or target another workspace                | [Claude Code #28041](https://github.com/anthropics/claude-code/issues/28041), [#36182](https://github.com/anthropics/claude-code/issues/36182) | Diagnose resolved paths/integrations and consider explicit project binding.              |
| Users request duplication/conflict/instruction-budget diagnostics                  | [Claude Code #85477](https://github.com/anthropics/claude-code/issues/85477)                                                                   | Test demand for rule-maintenance tooling without promising semantic conflict detection.  |
| Hooks support lifecycle automation independently of model command selection        | [Claude Code hooks guide](https://code.claude.com/docs/en/hooks-guide)                                                                         | Build separately tested host adapters around the existing CLI.                           |
| Rule layers and precedence differ across hosts                                     | [Cursor rules](https://prod.cursor.com/help/customization/rules)                                                                               | Declare adapter capabilities and limitations explicitly.                                 |

Maintainer-supplied community feedback additionally asked for changed-rule detail,
staging/production separation, and the number of rules behind a passing check.
These are paraphrased conversation inputs, not independently measured demand.
0.3.0 addresses the active-count/empty-pass distinction already.

## 0.3.1: onboarding clarity

Priority: immediate. No verifier or schema changes.

- Remove obsolete pre-publication instructions and align version pins.
- Document verify policies, snapshot/init usage, and policy exit semantics.
- Provide a disposable first-rule walkthrough: empty pass, missing rule, reviewed
  baseline pass, and same-ID changed-rule failure.
- Preserve a clear distinction between snapshot creation and baseline adoption.

Acceptance: execute the walkthrough using a built package from a separate consumer
directory; observe expected statuses/codes and verify that verification does not
rewrite the saved baseline. Check documented flags against actual CLI behavior.

## 0.4: explainable verification (implemented)

Implemented in 0.4.0 under [ADR 0004](decisions/0004-explainable-verification.md):
manifest-only explain, opt-in v3 retained-content snapshots and field-level deltas,
and Markdown reports. Default v2 snapshots and existing v1/v2 JSON remain compatible.
The following acceptance criteria govern the implementation; pilot measurements
remain future work and are not implied by shipping these features.

Priority: high. Dependencies: an ADR for snapshot evolution and privacy/storage choices.

1. Add an `explain` command showing scope/global selection and lifecycle decisions
   using the same pure evaluation logic, with explicit evaluation time.
2. Design opt-in retention of canonical old rule content for field-level diffs.
   Hash-only snapshots cannot reconstruct old text. Preserve existing snapshot
   support and clearly report when old content is unavailable.
3. Offer a deterministic Markdown report for local review and CI artifacts/job
   summaries, with scope, time, active count, tracking mode, policies, and findings.

Acceptance:

- Explain output agrees with verify at lifecycle boundaries and for global rules.
- Added/removed/changed fields are readable when old content exists; older
  snapshots still detect CHANGED without invented old values.
- Terminal/Markdown output safely renders untrusted rule text.
- Reports and verification never silently recapture or adopt a baseline.
- Evaluate storage size and sensitive-content exposure before choosing defaults.

## 0.5: automatic checks and installation diagnostics (implemented)

Implemented under [ADR 0005](decisions/0005-local-diagnostics-and-lifecycle.md):
read-only doctor, stdout-only snippet and Claude advisory SessionStart adapter.
Codex/Cursor interfaces were investigated/documented; adapters are not shipped.
Tests simulate host protocol and execute generated commands; live model-context
delivery is not claimed. Pilot recruitment remains future work.

Priority: high, after explainability. No second verification engine.

1. Add read-only `doctor` diagnostics for resolved config/input paths, supported
   schema versions, installed managed integrations, and package pins.
2. Add opt-in Claude Code lifecycle adapters for startup/resume/compaction where
   current host documentation and executable tests support them.
3. Publish a capability matrix for each host. Investigate Codex and Cursor
   integrations against their actual supported interfaces before promising parity.
4. Document critical-action integration recipes that re-run verification near the
   action instead of reusing an hours-old session-start result.

Acceptance:

- Adapter fixtures cover supported event payloads, timeouts, invalid inputs,
  mismatch results, worktree paths, and existing user configuration preservation.
- Distinguish advisory context injection from actual action blocking; a lifecycle
  notification must never be described as a deployment permission boundary.
- Missing integrations and unsupported hosts are explicit, actionable diagnostics.
- No automatic baseline refresh, silent policy opt-in, or hook installation overwrite.
- No claim that doctor can see every instruction or hidden host memory.

## 0.6: project and environment correctness (implemented)

Implemented under [ADR 0006](decisions/0006-project-profiles-and-reports.md):
opt-in manifest3/handoff4 project binding, config2 explicit profiles and optional
reproducibility reports with separately requested Git metadata. Existing unbound
workflows are preserved; no profile/identity is inferred. Pilot recruitment and
real-world measurements remain future work, not completed validation claims.

Priority: medium/high; validate with worktree and multi-environment pilots first.

1. Design opt-in project identity binding in a versioned contract. Use a portable
   explicit identity rather than treating an absolute folder path as identity.
2. Explore named environment profiles selecting an explicit scope and input paths.
   Never infer production authorization from a branch name or directory.
3. Include reproducibility metadata in an optional report: input digests, selected
   policies, package version, evaluation time, and explicitly requested Git context.

Acceptance:

- Configured cross-project and scope mismatches fail with actionable diagnostics.
- Worktrees retain project identity while resolving their own configured inputs.
- Existing unbound inputs remain supported under documented compatibility rules.
- Reports are described as local records, not authenticated attestations or proof
  of agent compliance. Revalidate changed inputs rather than trusting old reports.

## Later: rule maintenance, gated by pilot demand

Priority: medium. Keep source inspection separate from normal verify semantics.

- Explore explicit local source bindings and a separate read-only source-check
  command. A referenced file edit can signal review needed; it does not prove the
  rule's meaning changed. Decide full-file versus section binding deliberately.
- Consider owner/review-by metadata. Overdue review is distinct from rule expiry;
  it must not silently deactivate a restriction.
- Consider explicitly declared relationships such as conflicts/requires. Validate
  these deterministically; defer free-text contradiction inference.

Acceptance: each addition has a versioned schema/ADR, migration guidance,
deterministic tests, and no implicit network fetches, arbitrary command execution,
or autonomous manifest edits. Optional file reads belong in the CLI adapter.

## Pilot validation and release gates

Recruit at least five consenting repositories across single-agent, multi-agent/
worktree, and staging/production workflows. Recruitment and interviews have not
yet happened; do not present this desk research as user validation.

Track installation-to-first-meaningful-check time, ability to explain a failure,
time to resolve changed-rule findings, skipped checks, and unnecessary warnings.
Use synthetic or voluntarily redacted examples; no default telemetry or transcript
collection. Establish a baseline before claiming improvement percentages.

For each milestone: reproduce a real problem, agree on semantics in an ADR,
implement focused PRs, run local checks and packed consumer tests, review/merge,
then use the existing reviewed-artifact release process. Changes affecting host
adapters require host-specific tests as well as the platform matrix.

Defer hosted dashboards, a general memory platform, automatic prose-to-rule
extraction, arbitrary policy scripts, and claims of universal agent enforcement.
Reprioritize this plan based on pilot evidence rather than adding all features
to a single release.
