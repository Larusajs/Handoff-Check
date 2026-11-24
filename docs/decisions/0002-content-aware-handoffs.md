# ADR 0002: Content-aware handoffs

Status: accepted for 0.2.0.

## Formats and compatibility

Manifest v1 and handoff v1 keep their existing schemas. A v1 handoff still checks
IDs only against either manifest format. Its JSON result stays schemaVersion 1
with the existing fields. Text output explicitly identifies ID-only checking.

Manifest v2 adds required `revision` to each constraint: a positive safe integer
(1 through 9007199254740991). Handoff v2 records `task`, `scope`, `capturedAt`, and
`activeConstraints` objects containing `id`, `revision`, and `contentHash`.
IDs remain unique. Unknown fields, malformed hashes, and invalid revisions fail
as invalid input. Both input formats are versioned independently.

A v2 handoff works with either manifest. Manifest v1 rules have implicit revision
1, so an existing manifest can adopt content tracking without being rewritten.
A revisioned v2 manifest works with v1 handoffs in ID-only mode. `--require-content`
rejects a v1 handoff with exit 2 instead of silently falling back. New skills and
generated CI use this option; old integrations must be upgraded explicitly.

## Canonical content algorithm v1

Serialize the following object, in exactly this field order, using ECMAScript
`JSON.stringify` without indentation, then encode as UTF-8 and compute SHA-256:

1. `id`
2. `scope`
3. `description`
4. `source`
5. `expiresAt`
6. `revokedAt`
7. `replacedBy`
8. `supersededAt`

Required strings are preserved exactly, with no trimming or Unicode normalization.
Absent optional fields are represented as JSON null in this canonical object;
explicit null in input remains invalid. Timestamps normalize through
`Date.toISOString()` to UTC milliseconds. Revision is excluded from the hash and
compared separately. The stored syntax is `sha256:` plus 64 lowercase hex digits.
Reordering JSON properties, formatting JSON, or using equivalent UTC fractional
representations does not change the hash. Changing any hashed string does.

This algorithm is part of the v2 contract. Any incompatible canonicalization
change requires a new contract version, not silent rehashing. A golden fixture
independently verifies the hash contract in tests.

Only literal source-reference text is hashed. Referenced documents are never
fetched or hashed. These hashes are change detectors, not signatures or proof of
authorization; someone who controls both files can replace both values.

## Capture and verification

`snapshot --task <text>` reads the manifest and captures the selected/global rules
that apply at the explicit or once-captured current clock. It does not read the
existing handoff, rewrite the manifest, or infer constraints from task prose.
Default stdout is a complete v2 JSON handoff. `--output <new-path>` creates a new
file exclusively and refuses existing paths; write failures return exit 2 and may
leave a partial newly created file, which must be inspected before retrying.

`capturedAt` is normalized metadata, not the evaluation clock, an activation rule,
or authenticated history. Verification uses current time unless --as-of is
explicit. A fixed evaluation time may predate capturedAt; that describes the
supplied files at the chosen instant, not a reconstructed historical Git version.
Selected scope must equal the v2 handoff scope or verification returns exit 2.

For an active reported ID, a revision OR content-hash difference produces one
CHANGED finding. Both differences are reported together with expected/reported
revision and hash. Missing rules remain MISSING. Unknown, out-of-scope, revoked,
superseded, and expired primary findings retain lifecycle precedence over CHANGED.
Adding a future lifecycle timestamp is CHANGED immediately while the rule is
active; once the timestamp takes effect its lifecycle finding wins.

V2 results use schemaVersion 2 and `tracking: "content"`; ID lists remain sorted,
and findings remain ordered by ID then code. Revision decreases are differences
too; monotonic revision history is not verified. Old text is not stored, so the
tool does not show a textual diff.

Capture at handoff creation or after an explicit review of changed rules. Never
recapture a baseline automatically before checking a resumed task: that would hide
the changes the check is intended to find. Verification and CI remain read-only.
