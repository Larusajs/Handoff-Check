# Roadmap

## Initial MVP

- Versioned manifest and handoff contracts, with strict local validation.
- Deterministic verification of missing, expired, revoked, superseded,
  out-of-scope, and unknown constraint IDs.
- Text and JSON CLI output with documented exit codes.
- A fixed-clock failing and corrected demo, acceptance tests, and CI.

## After the checker is validated

- Thin Claude Code and Codex adapters using the same CLI.
- Package installation smoke tests and a reviewed first release.

## Outside the initial scope

- Inferring constraints from prose or agent transcripts.
- Fetching or authenticating source references.
- Editing manifests automatically or granting execution permissions.
- Hosted services, model calls, and agent-specific verification engines.
