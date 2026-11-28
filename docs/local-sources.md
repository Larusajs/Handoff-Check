# Explicit local source change checks

Some rules point to a policy document that can change while the rule's own
description/source reference stays the same. Optional local source registries
record an exact whole-file SHA-256 alongside the existing rule revision/hash.
`source-check` reports changed bytes as a reason to review, never as proof that
the policy's meaning changed. Existing verification does not read source files.

## Declare bindings and record reviewed files

Create a binding plan deliberately, using actual rule IDs and local files:

```json
{
  "schemaVersion": 1,
  "projectId": "your-project-id",
  "bindings": [{ "id": "C-01", "path": "docs/deployment-policy.md" }]
}
```

For unbound manifests, omit projectId from both plan and registry. Bound inputs
must match manifest/config identity exactly. Every selected/global active rule
needs an explicit binding for capture. One rule maps to one file in v1; several
rules may explicitly map to the same path. Unknown plan IDs are invalid, while
known inactive/out-of-scope bindings are ignored without reading their files.

After reviewing the current rules and those files, run:

```sh
npx handoff-check@0.12.0 source-record --profile production --bindings source-bindings.json --output sources.next.json
```

Choose the intended configured profile. The plan path is relative to cwd; each
bound file path is relative to the config's directory, or cwd when using the
implicit default/no config. `--constraints` can select a manifest elsewhere but
does not move that source root. `--config` and explicit profiles follow existing
selection rules; profiles reject scope/manifest overrides. Neither new command
reads a handoff or infers paths from manifest source text/URLs.

Capture freezes one evaluation time and writes only references, relative paths,
file hashes and capturedAt, not source text. Without `--output` it prints JSON.
With output it exclusively creates a new file with an existing parent, refusing
existing files/directories/symlink leaves. Any missing/unsafe/unreadable/oversize
selected file makes capture fail with exit 2 and no registry output. A failure
while writing can leave a partial new output: inspect before retrying. Never
redirect stdout onto an existing config, manifest, plan, registry or handoff.

The record is a selected/global **subset** of a project-wide registry, not a merge
or update of an existing file. Review/adopt it explicitly, preserving records for
other scopes as needed. There is no automatic merge, adoption, overwrite, missing
directory creation or refresh. Do not capture again merely to clear a finding.

## Check an explicit registry

```sh
npx handoff-check@0.12.0 source-check --profile production --sources sources.next.json
npx handoff-check@0.12.0 source-check --profile production --sources sources.next.json --format json
npx handoff-check@0.12.0 source-check --profile production --sources sources.next.json --format markdown
```

`--sources` is required and resolves from cwd. Each active rule first compares
the saved revision/hash with the current rule. Missing or stale bindings never
trigger guessed file reads. Known inactive rules and unknown registry IDs are
also not read. Truly unknown IDs require project-wide cleanup attention; known
inactive entries are only ignored/count. Selection uses explain's same scope,
global and lifecycle classifier at one evaluation time.

| Status            | Meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| UNCHANGED         | Current rule reference and identical source file bytes.              |
| MISSING_BINDING   | Active rule has no source registry entry. No file read.              |
| STALE_BINDING     | Revision or canonical rule hash differs. No file read.               |
| SOURCE_CHANGED    | Current rule reference but the whole-file hash differs.              |
| SOURCE_MISSING    | The explicit file or a parent is absent.                             |
| SOURCE_UNREADABLE | Filesystem access/read/close failed.                                 |
| SOURCE_UNSAFE     | Symlink/special-file/path containment or file-identity check failed. |
| SOURCE_TOO_LARGE  | File is larger than 10 MiB, including growth during reading.         |

Reports include active/unchanged/registry/ignored counts, per-rule expected and
observed hashes when available, and deterministic ID ordering. UNKNOWN_RULE
findings flag orphan IDs, and NO_ACTIVE_CONSTRAINTS marks zero-active checks
without a fabricated ID. An unchanged source cannot approve a changed rule:
STALE_BINDING takes precedence over all file observations.

Exit codes: **0** all active sources unchanged and no orphan IDs; **1** attention
(including unavailable/unsafe/oversize files, missing/stale bindings, orphan IDs
and zero active); **2** invalid invocation/contract/project binding or unreadable
metadata. Source-record succeeds with 0 or fails with 2. Reports use stdout;
invalid errors use stderr. `--format` on source-record only controls its saved-file
acknowledgement; its actual record is always JSON, and Markdown is unsupported.

## Paths, bytes and resource limits

Bound paths are portable relative POSIX paths using `/`, up to 1024 Unicode
characters and 255 per component. Absolute/drive/UNC/URL paths, backslashes,
empty/dot/dotdot components, trailing dots/spaces, Windows reserved device names,
invalid Unicode and control/format characters are rejected. No environment,
tilde, shell or glob expansion is performed. Spaces and ordinary Unicode are
literal file-name data. All metadata entries are validated, even ignored ones.

The selected project directory itself is canonicalized (an explicit config root
may resolve through a symlink). Every component **below** that canonical root,
including the file, rejects symlinks, even ones pointing inside the project.
Resolved containment is checked by path components, and open uses nonblocking /
no-follow flags where available with regular-file and file-identity checks.
Directories, FIFOs, devices and other nonregular sources are not read. Metadata
JSON files are explicitly chosen separately and can be regular-file symlinks.

Each plan/registry allows at most 256 entries. Files may contain binary data, but
each is limited to **10 MiB inclusive**. A 64 KiB read buffer and a maximum-limit
plus one byte probe enforce the bound even when stat size is stale or a file grows.
Identical path strings share one successful or failed observation per invocation;
case/Unicode aliases are not silently normalized into a different declared path.
Hashing is SHA-256 of raw bytes: CRLF/LF, BOM, whitespace and invalid UTF-8 all count.
No mtime/size-only shortcut, section parsing, recursive scan or source text storage.

JSON schemas describe the independent [binding plan](../schemas/source-bindings.v1.schema.json),
[registry](../schemas/source-registry.v1.schema.json) and
[result](../schemas/source-result.v1.schema.json). Runtime additionally enforces
unique IDs, portable path component rules, real calendar timestamps, project and
reference agreement, and filesystem safety/limits. The existing canonical rule
hash contract and manifest/handoff schemas are unchanged.

## Limits and privacy

Source-check is opt-in local inspection, not an authenticated review, semantic
policy diff, authorization grant or sandbox. The explicit binding is a local
declaration; manifest source text is never fetched/interpreted. Hashes and file
paths can still reveal information: review metadata before sharing it. Reports
never include file contents or raw operating-system error messages.

Checks are not atomic with file changes or adversarial directory replacement.
Concurrent writes can produce a hash of bytes observed during a changing read;
the command does not lock files or prove an authorized historical state. Hard
links and platform filesystem behavior retain normal OS semantics. No guaranteed
wall-clock timeout is imposed on unresponsive OS/network-mounted filesystem I/O.
There are no HTTP/model/Git subprocess calls; an OS-mounted filesystem may itself
use a network. Resource limits bound bytes/entry count, not every OS operation.

`capturedAt` is informational, not evidence of review or an instruction to reuse
an old clock. `--as-of` supports reproducible applicability selection; it does
not read historical file contents. File bytes are read now. Verify/run/review,
doctor and lifecycle hooks never implicitly load this registry or the bound files.
A new source record does not clear a CHANGED handoff or stale review record.

## Reproducible synthetic example

From a checkout, without creating any handoff:

```sh
npx handoff-check@0.12.0 source-check --config examples/local-sources/config.json --profile stage --sources examples/local-sources/sources.json --as-of 2026-11-27T08:00:00Z --format json
```

Expect unchanged/exit 0 for two active rules sharing policy.md. In a disposable
copy, edit policy.md and repeat: expect SOURCE_CHANGED/exit 1. Changing only a
rule description instead yields STALE_BINDING for that rule without reading its
source. The shipped stage registry is a subset; profile prod reports missing P-01
and ignores the known staging-only entry.
