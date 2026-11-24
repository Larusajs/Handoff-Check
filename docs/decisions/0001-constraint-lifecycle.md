# ADR 0001: Explicit scope and time-based lifecycle

Status: accepted for schema version 1.

## Contract

Both inputs are versioned objects. A manifest contains `schemaVersion: 1` and a
`constraints` array; a handoff contains `schemaVersion: 1`, `task`, and
`activeConstraints`. Unknown fields are rejected to catch misspelled restrictions.

Each constraint requires a unique `id`, one explicit `scope`, a non-empty
`description`, and a non-empty `source` reference. IDs and scopes use ASCII letters,
digits, dots, underscores, and hyphens, beginning with a letter or digit. IDs and
scopes are case-sensitive. Handoff IDs must also be unique.

`global` is reserved for constraints applicable to every scope. Selecting `global`
evaluates only global rules. Other scope names are arbitrary; no scope hierarchy or
registry is inferred. A scope absent from the manifest still includes global rules.

UTC timestamps require `YYYY-MM-DDTHH:mm:ss[.SSS]Z` with one to three optional
fractional digits and a real calendar date. Offsets and leap seconds are rejected.
At or after `expiresAt`, `revokedAt`, or `supersededAt`, the corresponding lifecycle
transition applies. Without a fixed clock, the CLI captures the current time once.

## Replacement

`replacedBy` and `supersededAt` must appear together. The target must exist in the
same scope. Self-references and cycles are invalid. Replacement chains are allowed.
Supersession remains effective even if the replacement is later expired or revoked;
old constraints never implicitly reactivate.

All entries otherwise apply immediately, including replacement targets. Therefore,
before a future supersededAt time, both old and replacement rules may be active.
Version 1 has no activation timestamp. Historical checks describe the supplied
manifest at the selected time, not a reconstruction of a past Git revision.

## Findings

Expected IDs are active rules in the selected or global scope. Missing expected IDs
produce MISSING. Each unexpected reported ID gets one primary finding, in this
precedence: UNKNOWN, OUT_OF_SCOPE, REVOKED, SUPERSEDED, EXPIRED.

Expected/reported lists are sorted by ASCII ID; findings by ID, then code. JSON
includes a schemaVersion, normalized evaluation time, scope, lists, and findings.
Validation errors go to stderr; verification results go to stdout.

## Tradeoffs

Explicit timestamps permit reproducible lifecycle checks. Same-scope replacement
prevents a staging change from disabling a global rule. A strict schema catches
typos at the cost of requiring a schema revision for future extensions.
