# Roadmap

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
- Confirm registry identity and obtain explicit authorization before publishing.

## Outside the initial scope

- Inferring constraints from prose or agent transcripts.
- Fetching or authenticating source references.
- Editing manifests automatically or granting execution permissions.
- Hosted services, model calls, and agent-specific verification engines.
