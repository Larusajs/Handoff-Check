# ADR 0007: explicit snapshot diff and new-project guided setup

Status: accepted for 0.7.0.

Compare two validated content-aware handoffs, rather than inventing a manifest
history or reading agent transcripts. Require identical scope and project binding;
permit unbound v2/v3 interoperability and same-project v4 mode interoperability.
Compare revision/hash references with existing canonical semantics. Only two-sided
retention enables field details through the shared field comparator. Metadata and
retention-only changes are ignored. No lifecycle inference, chronology assertion,
source authentication or baseline adoption follows from diff. JSON is independently
versioned; exits 0/1/2 mean unchanged/different/invalid.

Keep old init stable. A separate terminal-only setup builds new config2/manifest3/
retained-handoff4 files with explicit identity, environment profiles and one real
user-authored global rule. It reuses strict parsers and the pure snapshot core.
The preview is exactly the approved bytes. Only affirmative yes writes; all target
conflicts are preflighted and exclusive creation prevents overwrites. No nested
paths or instruction append operations are offered, so existing init integration
planning remains separate. Writes are explicitly nontransactional with a written
path list on failure. No migrations, automatic baseline refresh, package installs,
host setting edits, skills or CI installs are implicit.

The bounded onboarding scope trades a general configuration editor for a short
reviewable first meaningful check. New owner/review metadata, source file watching,
critical-command wrappers and other host adapters remain separate future proposals.
