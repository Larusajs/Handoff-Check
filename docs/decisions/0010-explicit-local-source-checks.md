# ADR 0010: explicit bounded whole-file source checks

Status: accepted for 0.10.0.

Keep source inspection separate from default verification. A v1 binding plan
declares rule IDs and portable project-relative paths; source-record captures
selected/global active rules into a v1 registry with existing rule revision/hash,
whole-file SHA-256 and informational capturedAt. Both metadata formats support
strict matching optional project binding without evolving old manifest/handoff/
review contracts. No URL, source-reference or directory-scan inference.

Source-check uses explain's lifecycle selection and validates current rule
references before file I/O. Missing/stale/inactive/orphan entries do not trigger
source reads. Orphan registry IDs need attention project-wide; known inactive
ones are ignored/count. Empty active sets need attention. Source-record requires
every selected active rule mapped and rejects unknown plan IDs before reading.
Capture is explicit after review, stdout or exclusive new output only; no merge,
adoption, overwrite, baseline refresh or implicit enforcement.

Files resolve below the canonical config-directory project root. Portable path
validation, component symlink rejection, realpath containment, nonblocking /
no-follow open where available, regular-file and device/inode agreement provide
ordinary filesystem safeguards. Bound reads stream raw bytes up to an inclusive
10 MiB with growth enforcement; metadata allows at most 256 entries. Cache each
exact path string's observation (including failures) once per invocation. Source
text is never rendered/retained; no semantic diff, mtime shortcuts or sections.

Source-check exits 0 unchanged, 1 attention, 2 invalid metadata/invocation. Source
unavailability/unsafe/oversize is per-file attention; capture failure is invalid
and produces no registry. Report JSON is independently versioned. Existing verify,
run, review, doctor and lifecycle behavior must not implicitly load these files.

This is not authentication, permission or a race-free sandbox. Root symlinks may
resolve to an explicitly selected project; descendants reject links. OS/platform/
hard-link semantics and concurrent replacement/writes remain limitations, with no
atomic historical read or guaranteed timeout for stuck OS I/O. Fixed as-of affects
rule selection only; file bytes are current, capturedAt unauthenticated metadata.
Pilot measurements, section bindings and relationship diagnostics remain future
work, not validation claims attached to this implementation.
