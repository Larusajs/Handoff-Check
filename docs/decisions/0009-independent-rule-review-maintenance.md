# ADR 0009: independent, reference-bound rule review maintenance

Status: accepted for 0.9.0.

Track owner/review windows separately from constraint applicability. Registry v1
stores exact id/revision/canonicalHash references plus owner/reviewedAt/reviewBy,
with matching optional portable project binding. Strict UTC/window/unique-ID
validation prevents ambiguous records. Reuse existing canonical hashes; do not
add maintenance fields to old manifests, snapshots or verification results.

Review uses explain's scope/global/lifecycle selection, then compares references
before temporal metadata. Primary precedence is missing, stale, future-reviewed,
overdue, current; reviewedAt <= evaluation < reviewBy is current. Known inactive
entries are ignored/count; true orphan IDs need attention project-wide. Zero
active rules also need attention. Exit 0 means current maintenance, 1 attention,
2 invalid. Output JSON has its own v1 schema, independent of verification.

Review-record is an explicit record-after-review operation: capture selected/global
active references at one time with one chosen owner/deadline. Emit stdout JSON or
create an exclusive new file; no overwrite, merge, adoption, missing-directory
creation or implicit changes to handoffs. The output is a subset of a project-wide
registry; adopting it requires preserving/reviewing other scopes deliberately.

Overdue review is not expiration and must never silently deactivate restrictions.
Neither verify/run nor advisory lifecycle/doctor implicitly read the registry.
Records are unauthenticated declarations and may include personal owner data.
Do not claim authenticated authorship, review time, behavioral compliance or
permission. No source inspection, contact lookup, notification or model calls.
Explicit fixed clocks remain useful for reproducible fixtures, not authority.

Future source-file change checks and relationship diagnostics remain separate
proposals. A metadata feature must not evolve into implicit source fetching or
free-text contradiction inference. Pilot recruitment and real-user measurements
remain future work; implementation does not claim those experiments happened.
