# Changelog

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
