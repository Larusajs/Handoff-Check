# A daily combined check

With an existing reviewed configuration and Node.js 22+, run:

```sh
npx handoff-check@0.12.0 check --profile production
npx handoff-check@0.12.0 check --profile production --registry rules.review.json --sources sources.json --format json
```

Choose an explicitly configured profile, or use --scope with optional
--constraints/--handoff overrides. Profile selection rejects those overrides.
--config chooses the configuration; configured inputs and source bindings resolve
from its directory. Explicit input, registry and sources paths resolve from cwd.

Every check verifies the saved handoff with mandatory content tracking and at
least one active rule. Legacy ID-only handoffs are invalid. There are no force,
skip, policy override, output, Git, child-command or recording flags. Use
--as-of <UTC time> only for reproducible evaluation; the default captures one
current clock after metadata reads. Sources are always current file bytes.

Review is included only with --registry; source inspection only with --sources.
No maintenance registry is discovered implicitly. Omitted sections are explicitly
NOT-REQUESTED, not passed. Use the existing review-record/source-record workflows
after actual review; check never captures, adopts, refreshes or writes inputs.

## Reports and failures

Text, JSON and Markdown show verification, review and sources independently.
JSON uses [combined schema v1](../schemas/check.v1.schema.json), kind combined-check,
with status passed, attention or invalid. Each selected section contains its
unchanged engine result and passed/attention state, or invalid with a bounded
diagnostic. Invalid sections never contain fabricated successful results.
Unselected sections contain only status not-requested. The summary counts all
three sections; requestedChecks excludes not-requested sections.

The schema validates section shapes and engine-status coupling. Runtime engines
enforce semantic relationships, shared context, aggregate precedence and summary
counts; JSON Schema alone does not prove those invariants or input authenticity.

Exit 2 (any invalid section) takes precedence over exit 1 (attention); exit 0
means every requested section passed. Zero active rules need attention. A passing
verification cannot hide overdue reviews or changed sources; an invalid optional
registry cannot hide valid verification or source findings.

Invalid invocation, config, profile, manifest, common project identity, scope or
clock fails normally on stderr with exit 2 and no combined stdout. Once common
inputs are valid, missing/malformed handoff or selected registry, legacy handoff,
and selected role binding failures appear on stdout in the combined report,
with exit 2. Check all sections before interpreting its status.

Selecting --sources explicitly authorizes its independent reads even when the
handoff is invalid. Source metadata and project identity must validate first.
Only selected active rules with current references produce read targets; stale,
missing, inactive and orphan entries do not. The existing portable-path,
symlink, regular-file, 10 MiB and 256-entry safeguards remain in force.

Each resolved metadata pathname is read once per invocation, including config and
failed reads; each role is still parsed independently if paths coincide. Filesystem
aliases through symlinks/hard links are not deduplicated identities. Shared exact
source paths use the source adapter's observation cache. Input reads and source
observations are not atomic. There is no guaranteed timeout for stuck OS I/O.

## Limits and privacy

A local pass checks declarations and explicitly selected records, not agent
behavior, authenticated review or permission to act. Check never executes a child,
reads transcripts, fetches references or calls models. Hashes, paths, owner data
and retained rule content in nested findings may be sensitive; review reports
before sharing. Shell redirection can truncate files independently of this CLI:
never redirect reports onto inputs.

Default verify/run/review/source-check outputs and policies remain unchanged.
Run can explicitly select maintenance with --registry/--sources in 0.12, but this
command does not install hooks or enable maintenance in another workflow.
