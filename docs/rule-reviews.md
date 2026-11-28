# Rule ownership and review deadlines

Maintenance metadata lives in a separate versioned registry. It identifies an
owner and review window for an exact rule revision/hash without changing a rule,
handoff, canonical hash or existing verification result. A deadline needing
attention never expires, revokes or disables the underlying constraint.

## Record a deliberate review

Read the current applicable descriptions with explain, then review them through
your normal process. Only after that review, explicitly record the selected
scope's active rules (including global rules):

```sh
npx handoff-check@0.11.0 explain --profile stage
npx handoff-check@0.11.0 review-record --profile stage --owner platform-team --review-by 2027-01-01T00:00:00Z --output rules.review.next.json
```

The owner/deadline are examples. One owner and deadline apply to **every** active
rule captured by that invocation, including global rules. Choose the intended
owner and review interval explicitly. Review the resulting file before adopting
it as your team's registry. To assign different owners, deliberately edit and
validate the separate entries or combine independently reviewed records by unique
ID. This command does not discover people, send notifications or authenticate
who reviewed a rule.

Without `--output`, review-record writes JSON to stdout. With it, exclusive
creation requires a new file with an existing parent; existing files, symlink
leaves and directories are refused. The record is computed once and input files
are never rewritten. An I/O failure can leave a partial new output; inspect it
before retrying. Shell redirection can itself truncate files, so do not redirect
stdout onto an existing registry, config, manifest or handoff.

This captures a **subset**, not an update/merge of an existing project registry.
Replacing an aggregate registry with one scope's subset can drop ownership data
for other scopes. There is no automatic merge, adoption, baseline refresh or
registry discovery. Record after reviewing changes, never merely to clear a
maintenance finding. No-active-rules capture fails with exit 2.

## Check maintenance independently

```sh
npx handoff-check@0.11.0 review --profile stage --registry rules.review.next.json
npx handoff-check@0.11.0 review --profile stage --registry rules.review.next.json --format json
npx handoff-check@0.11.0 review --profile stage --registry rules.review.next.json --format markdown
```

An explicit `--registry` path is required and resolves from cwd. `--config`
chooses the config, configured manifest paths resolve from its directory, and
explicit `--constraints` paths resolve from cwd. Profiles are explicit and reject
scope/manifest overrides, exactly as other commands. Neither command reads a
handoff, even if config contains a missing handoff path. Config project binding
still applies. Both unbound inputs and same-project bound manifests/registries
are supported; mixed binding or different IDs are invalid. No data migration or
new config/manifest/handoff format is needed. Inputs must be regular readable
files (symlinks to regular files work); no source references are fetched.

The current clock is captured after reads. `--as-of <UTC time>` is available for
reproducible checks and records, not proof that a person reviewed at that time.
Rule applicability uses the same scope/global/lifecycle decisions as explain.

Each active rule has one primary status, in this order:

| Status         | Meaning                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| MISSING_REVIEW | No entry exists for this active ID.                                                                         |
| STALE_REVIEW   | Recorded revision or canonical content hash differs. Owner/time shown belong to the old reviewed reference. |
| FUTURE_REVIEW  | The matching record claims a reviewedAt later than the evaluation time.                                     |
| OVERDUE_REVIEW | The matching record's reviewBy is at or before evaluation time.                                             |
| CURRENT        | Matching reference and reviewedAt <= evaluation time < reviewBy.                                            |

Revision-only changes, including regressions, are stale even when the content hash
is unchanged. Same-ID content edits are stale without requiring a revision bump.
Stale takes precedence over future/overdue time. Known inactive/out-of-scope entries
are ignored and counted; they are not orphaned. IDs absent from the whole manifest
produce UNKNOWN_RULE findings regardless of the selected scope, because the registry
is project-wide. A zero-active check produces NO_ACTIVE_CONSTRAINTS without a fake ID.
Output sorts IDs and reports active/current/registry/ignored counts separately.

Exit codes: **0** all selected active rules have current review and no orphan IDs;
**1** maintenance attention (including zero active); **2** invalid invocation,
contract, project binding or unreadable file. Review-record succeeds with 0 or
fails with 2. Reports go to stdout, invalid errors to stderr. Text and Markdown
escape untrusted owner data. JSON remains structured data, not executable text.

## Registry contract and privacy

See [registry schema](../schemas/review-registry.v1.schema.json) and
[result schema](../schemas/review-result.v1.schema.json). Each registry entry
requires id, positive safe revision, canonical lowercase SHA-256, nonempty owner,
reviewedAt and reviewBy. Runtime validation additionally requires unique IDs,
real calendar dates and reviewBy strictly later than reviewedAt. Timestamps use
UTC with up to millisecond precision. Rule references reuse the existing frozen
hash contract; owner/review times do not enter that hash. Registries store no full
rule text but owner names may still be sensitive; review before sharing them.

This is an unauthenticated local declaration of review, not an attestation,
authorization grant, human identity check or evidence of agent behavior. It does
not inspect the contents of referenced policy documents. An unchanged source
reference does not detect edits inside the referenced document.

`verify`, `run`, doctor and lifecycle hooks never implicitly load this registry.
An overdue/missing/broken registry cannot silently change their policy. A fresh
review record also cannot clear a CHANGED handoff: verify the saved handoff and
resolve its findings through the existing explicit workflow. If a team wants
maintenance attention to stop a pipeline, invoke review as a separate explicit
step and handle its exit code through that team's normal process.

## Reproducible synthetic example

From a checkout, use the shipped fixtures:

```sh
npx handoff-check@0.11.0 review --config examples/rule-reviews/config.json --profile stage --registry examples/rule-reviews/reviews.json --as-of 2026-11-26T08:00:00Z --format json
```

Expect current/exit 0 with two active rules. At `2026-11-27T08:00:00Z` expect two
OVERDUE_REVIEW findings/exit 1. Selecting `--profile prod` at the first time instead
reports missing P-01 and one known inactive entry ignored. These fixtures are
maintenance-only and intentionally contain no handoff.
