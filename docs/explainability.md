# Explain applicability and review changes

Requires Handoff Check 0.6.0+ and Node.js 22+. Run from your configured repository.
No service, model call or API key is needed.

## Understand the active set

```sh
npx handoff-check@0.11.0 explain --format json
npx handoff-check@0.11.0 explain --scope production --format markdown
```

Explain reads the manifest but not the handoff. Every rule has an applicability
decision and reason; global rules count once. Use `--as-of` for an explicitly fixed
evaluation. It cannot reconstruct historic file contents. A valid explanation
exits 0 even with zero active rules: use verify to compare a handoff.

## Opt in to saved content

At a reviewed handoff creation, after upgrading all consumers to 0.4+:

```sh
npx handoff-check@0.11.0 snapshot --task "Review staging migrations" --include-content --output handoff.reviewed.json
npx handoff-check@0.11.0 verify --handoff handoff.reviewed.json --require-content --require-active --format markdown
```

Review the new file before explicitly adopting it in config. Snapshot never
overwrites a path. Unbound snapshots remain v2; the flag creates v3 containing
full old descriptions, sources, revision and lifecycle values. Consider sensitive
content before storing or sharing. Old v1/v2 files do not require migration. Bound manifest v3 capture creates handoff v4; see project-context.md.

After a same-ID description edit, verification produces CHANGED and exit 1.
V3 JSON adds typed `changes`; text and Markdown show the saved/current fields.
Revision-only edits appear too; null indicates an absent optional field. Expired,
revoked or superseded rules retain their primary lifecycle finding instead.
V2 detects changes but cannot show old text. V3 validates retained data against
its reference; it does not authenticate who reviewed or changed the rule.

Never recapture a saved baseline before checking resumed work. Resolve findings
and review changes before deliberately capturing and adopting a new baseline.

## Reports in local review or CI

Use `verify --format markdown` for a deterministic report with the same 0/1/2 exit
codes. Redirect it only to a separate report file; shell redirection can truncate
the destination before verification starts, including an input if misconfigured.
CI can upload that file as an artifact or display it in a job summary. Preserve
the verifier exit code so a report upload does not turn a mismatch into a pass.

Reports contain escaped user data, not commands to execute. A PASS checks declared
constraints, not their semantic enforcement, authenticity, or permission to act.

## Reproducible example

From the source checkout after building, run:

```sh
node dist/cli.js explain --constraints examples/retained-content/constraints.json --scope staging --as-of 2026-11-24T10:00:00Z --format markdown
node dist/cli.js verify --constraints examples/retained-content/constraints.json --handoff examples/retained-content/handoff.json --scope staging --as-of 2026-11-24T10:00:00Z --require-content --format markdown
```

The second command deliberately exits 1 and shows the old/current description.
See [ADR 0004](decisions/0004-explainable-verification.md) for precise contracts.
