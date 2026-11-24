# ADR 0003: Make empty verification explicit

Status: accepted for 0.3.0.

## Counts and empty results

The active count is the size of the expected set: rules applicable to the selected
scope plus global rules, after expiry, revocation and supersession. It is not the
number of reported IDs, successful matches, findings, or manifest entries. Missing
active rules still count. Globals count once. Fixed-time behavior stays stable.

Text always reports the count. A verified result with zero active rules is labeled
PASS (EMPTY) and says no active constraints apply to scope/time. It still exits 0
by default: an empty set is valid, but verifies no real active rule. Zero may also
mean all rules are inactive or in other scopes; do not infer an empty starter.

If unexpected IDs remain in a handoff with zero expected rules, the result stays
FAIL with those findings. Every zero-count text result has the scope/time notice.

## Machine-readable compatibility

V2 JSON adds numeric activeConstraintCount, equal to expectedConstraints.length
regardless of success/mismatch. Existing fields and input schemas stay unchanged;
consumers should allow additive metadata. Legacy v1 JSON keeps its exact default
shape; derive its count from expectedConstraints. No snapshot/hash changes occur.

## Optional nonempty policy

`verify --require-active` requires at least one expected active rule. This is an
explicit policy, not input validation: valid files with zero active rules return
mismatch and exit 1, rather than invalid input/exit 2. The core receives an explicit
optional policy parameter and never reads flags or files.

The zero set adds one global finding:

```json
{
  "code": "NO_ACTIVE_CONSTRAINTS",
  "message": "No active constraints apply to the selected scope and time; --require-active requires at least one"
}
```

It has no invented ID or revision/hash fields. Global findings sort before per-ID
findings. Existing stale/unknown findings remain; per-ID lifecycle/content
precedence and ID/code ordering stay unchanged. A nonempty expected set yields
the same result with or without this policy.

The option applies to both handoff formats. Legacy strict mode introduces the
documented opt-in finding but no v2 count metadata. Init and snapshot reject it;
capturing a reviewed empty set remains possible.

Skills and generated CI do not silently enable this policy. Starters have zero
rules and some scopes intentionally have none. Teams add --require-active after
authoring/reviewing constraints. Agents should report zero without presenting it
as validation of real policy. --require-content is independently combinable.
