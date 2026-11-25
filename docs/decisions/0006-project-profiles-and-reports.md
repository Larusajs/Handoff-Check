# ADR 0006: Explicit projects, profiles and reproducibility reports

Status: accepted for 0.6.0.

## Portable opt-in binding

Manifest v3 requires projectId (the existing case-sensitive identifier syntax)
and v2 revisioned constraints/relationship validation. Handoff v4 requires the
same projectId, scope, task, capturedAt, contentMode and activeConstraints.
contentMode is hashes or retained: every reference follows that mode; hashes
rejects content, retained requires full validated content consistent with the
reference. Canonical rule hashing is unchanged: outer projectId is not added to
the frozen eight-field hash algorithm. Standalone retained replacement semantics
remain unchanged.

If either input is bound, or an expected config projectId is supplied, verify
requires BOTH bound input formats with exactly matching IDs and expected identity.
Mixed binding, missing identity and mismatches are invalid input (exit 2), before
findings. Scope mismatch remains invalid. The pure verifier receives the expected
ID explicitly; it reads no config, Git or filesystem. With no binding requested,
old manifest v1/v2 and handoff v1/v2/v3 behave unchanged, including default JSON.

Snapshot from a bound manifest creates v4 hashes by default or v4 retained with
--include-content. Unbound capture still creates v2/v3. Expected binding cannot
turn an unbound manifest into a bound snapshot. Init defaults stay unbound and no
existing inputs are silently migrated. Upgrade consumers, verify/review the old
baseline FIRST, then deliberately migrate the manifest and capture/adopt a new
baseline. Do not refresh merely to clear findings.

Project IDs are explicit portable labels, not absolute paths or inferred remotes.
Worktrees can share one reviewed identity while resolving their own inputs. This
prevents accidental baseline interchange, not malicious edits: someone controlling
config/inputs can change labels together. It does not prove the cwd belongs to a
trusted repository or grant production authorization.

## Config v2 and environment profiles

Config v1 is unchanged. Config v2 adds optional projectId and optional profiles,
a nonempty object of identifier-named profiles. Each profile requires scope and
may override constraints/handoff paths. Omitted paths fall back to top-level
paths, then ordinary filenames. All configured paths resolve relative to the
config directory. All profiles are structurally validated when config loads;
unknown keys/null/invalid scopes/empty paths are rejected. JSON object semantics
apply; duplicate JSON property spellings are not an authenticated change history.

--profile selects explicitly; no default profile, saved selection, branch/cwd
inference, or environment permission is introduced. Reject combinations with
explicit --scope/--constraints/--handoff, even if values agree. --config remains
allowed. Missing profile/config v1 selection returns exit 2. Init rejects profiles;
author the reviewed config deliberately. Existing config without selection keeps
its ordinary top-level behavior.

Verify, snapshot, explain, doctor and lifecycle use one profile selector. A hook
configuration may carry explicit --profile in its exec-form args. The lifecycle
adapter validates binding and reports concise project/profile context, preserving
its advisory transport semantics and limits. Doctor diagnoses binding mismatches
as attention (exit 1); invalid profile selection is invocation error (exit 2).
Explain adds projectId only for bound manifests; it still compares no handoff.

## Reproducibility reports

Explicit verify --report requires --format json or markdown. JSON is a separate
schemaVersion 1 verification-report wrapper with packageVersion, policies,
inputs, optional profile/projectId/git, nested result and notice. Existing default
JSON is untouched. Markdown appends safely escaped metadata. No report file is
written automatically; stdout redirection must not target inputs.

Each input/config is read once as bytes; those exact bytes are both parsed and
hashed using sha256:lowercasehex. The config digest describes the original loaded
file even when CLI overrides are used. Absent implicit config is explicitly null,
never an invented digest. Paths are absolute resolved read paths; hashes describe
byte formatting as well as content, unlike the semantic rule hash. No source
documents are read. Report schema validates the wrapper and basic nested-result
structure; the nested result's behavior remains defined by verifier contracts.

--git-context is verify-only and requires --report. Fixed execFile argument vectors
read the invocation cwd's Git top-level worktree, HEAD commit and branch (null
when detached), without shell, fetch, index write or dirty-status inspection.
Requests are bounded to 2 seconds/256 KiB per Git command. Nonrepo/unborn/missing
Git/failure returns exit 2 and no successful report. If config is elsewhere, Git
still describes the invocation cwd, not an inferred identity for every input.

Reports are local records, not authenticated attestations, agent compliance proofs
or globally atomic snapshots. Git metadata and separate input reads may race with
other writers. Exact digests identify the bytes evaluated; revalidate before acting.
Paths/branch/project labels can disclose local information: review before sharing.
No default Git subprocess, telemetry, report persistence or signing is introduced.
