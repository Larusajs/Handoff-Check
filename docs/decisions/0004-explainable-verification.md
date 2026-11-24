# ADR 0004: Explainable verification

Status: accepted for 0.4.0.

## Compatibility and retention

Manifest formats remain v1/v2. Default snapshot remains handoff v2. Existing
handoff v1/v2 JSON result shapes and canonical hash algorithm v1 are unchanged.
`--require-content` accepts handoff v2 or v3 and rejects ID-only v1.

Explicit snapshot `--include-content` produces handoff schemaVersion 3. Each
reference requires `content`: a standalone v2 constraint object with required
positive safe revision and the same strict field/date/pair validation as manifest
rules. ID, revision and canonical hash must agree with the outer reference or
parsing fails with exit 2. Unknown fields and null input values remain invalid.
IDs remain unique. Stored content rejects self-replacement, but replacement
targets need not occur in the captured set; it is not a replacement manifest.
Global relationship checks still apply to the actual manifest.

Capture makes independent copies, preserves exact description/source strings,
normalizes lifecycle timestamps to UTC milliseconds, and supplies implicit revision
1 for manifest v1 rules. Empty captures are valid. Capture does not read the old
handoff or sources, infer rules, or promote/replace a baseline.

Retention copies full descriptions, source references and lifecycle fields into
handoffs and potentially reports. It is opt-in, with no auto-upgrade or default
retention. Review sensitive content and repository access before sharing. Consistent
hashes detect changes, not authorship or authorization. Someone controlling content
and reference can replace both. Older CLIs reject v3; upgrade consumers first.

## Deltas and results

V3 verification results use schemaVersion 3 with content tracking and active count.
Active reported CHANGED rules have `changes`, an ordered array of objects with
`field`, `before` (saved), and `after` (current). Values are strings, revision
numbers, or null for an absent optional field; null is not permitted in rule input.
Field order is id, scope, description, source, expiresAt, revokedAt, replacedBy,
supersededAt, revision. Equivalent normalized timestamps do not create changes.
Revision-only changes are included, despite revision being outside the content hash.

Scope/lifecycle precedence is unchanged. Inactive/unknown/missing rules do not get
invented deltas. V1/v2 findings do not gain fields. V2 CHANGED text/Markdown clearly
states old content is unavailable; hashes cannot reconstruct previous text.
Verification is read-only and never refreshes a baseline to clear a finding.

## Explain

`explain` reads only config/manifest, not the handoff. Its JSON contract is an
independent schemaVersion 1 object: scope, normalized asOf, activeConstraintCount,
and rules sorted by ID. Each rule has id, scope, description, source, decision,
and reason. Decision is ACTIVE, OUT_OF_SCOPE, REVOKED, SUPERSEDED, or EXPIRED.
The shared classifier uses the established scope-before-lifecycle precedence;
global rules apply everywhere and transitions take effect at their exact instant.
Reasons explain applicability of the supplied data, not prose meaning or history.

Valid explain exits 0 even when rules are inactive or the active set is empty;
this must never be presented as successful handoff verification. Invalid inputs
exit 2. No nonempty policy, handoff/task/output flag or include-content flag is
accepted by explain. It does not authenticate input or prove agent compliance.

## Rendering and command boundaries

Verify/explain support text, JSON and Markdown. Markdown reports include scope,
time, count and findings; verify additionally reports tracking and requested
policies. They do not include uncontrolled HTML, link syntax, fences or extra rows:
untrusted values are escaped as numeric entities and control/format characters
render visibly. JSON stays machine-readable; Markdown is a presentation format,
not an input contract. Both reports are deterministic for supplied inputs/options.

Verify exit codes remain 0 verified, 1 mismatch/policy failure, 2 invalid input.
Report output goes to stdout, errors to stderr; Markdown errors are terminal-safe
plain diagnostics. Shell redirection is external to the CLI and can overwrite its
destination: documentation must warn against directing reports onto input paths.

Markdown is rejected for init/snapshot, and include-content is snapshot-only.
Snapshot stdout remains JSON; text/json format controls its acknowledgement only
when an exclusive output file is requested. Skills and generated CI keep using
the single verifier; no automatic retention or new enforcement hook is installed.
