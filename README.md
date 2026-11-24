# Handoff Check

A deterministic, local CLI that verifies active constraints before a coding agent
resumes work.

**Version: 0.3.1.**

A task summary may preserve the goal while losing an active rule, carrying an
expired restriction, or moving a staging-only instruction into production.
Handoff Check compares the IDs in a handoff with a reviewed, versioned manifest
for the selected scope and time.

No API keys, network calls, model calls, or agent transcript access are required.
Source references are review metadata and are never fetched.

## Quick start

Run in the repository where your agent works:

```sh
npx handoff-check@0.3.1 init --scope staging --agent both --dry-run
npx handoff-check@0.3.1 init --scope staging --agent both
```

This creates `.handoff-check.json`, starter `constraints.json` and `handoff.json`,
installs skills for Codex and Claude Code, and appends managed instruction blocks
to `AGENTS.md` and `CLAUDE.md`. Choose `--agent codex`, `claude`, or `none` to limit
integrations. Scope is explicit; choose the intended environment.

Starters intentionally contain zero rules. Add reviewed constraints (v2 rules need
a positive `revision`), then capture a baseline as described below before relying
on verification. Revisions and hashes detect edits under an unchanged rule ID.
Ask a resuming agent to use the installed skill, or run:

```sh
npx handoff-check@0.3.1 verify --format json --require-content
```

The saved config supplies paths and scope. `init --ci` also creates a pinned GitHub
Actions verification workflow. Skill/instruction installation does not guarantee
agent execution; CI enforces the declared-ID comparison when its workflow runs.
Neither checks whether the agent obeys a rule's meaning.

Node.js 22+ is required; end users do not need Bun. Global installation is also
available: `npm install --global handoff-check@0.3.1`. For contributor builds or
offline package testing, see the [setup guide](docs/agent-integration.md).

For a complete first-rule walkthrough, including a passing baseline and a detected
edit, see [your first real check](docs/first-check.md).

## See how many rules were checked

Every text summary includes the expected active-rule count:

```text
PASS  7 active constraints checked | 0 findings | scope staging | ...
PASS (EMPTY)  0 active constraints checked | 0 findings | ... | No active constraints apply to this scope and time
```

This counts active selected/global rules, not reported IDs or total manifest
entries. Missing active rules count too. Zero may mean a starter, another scope,
or inactive rules; it does not prove the manifest is empty. Empty checks exit 0 by
default but are explicitly marked. Unexpected reported IDs still fail.

To require actual active rules, opt in:

```sh
npx handoff-check@0.3.1 verify --require-content --require-active --format json
```

A zero active set produces global NO_ACTIVE_CONSTRAINTS (no fake ID), mismatch
status and exit 1. Other findings remain. Invalid inputs still exit 2. V2 JSON
includes activeConstraintCount; legacy default JSON exposes the expected set in
expectedConstraints without changing its fields.

The policy is not automatically enabled in starter CI. After adding real rules,
append --require-active to the generated workflow command. It is verify-only;
init and snapshot reject it. See the
[empty verification contract](docs/decisions/0003-empty-verification.md).

## Catch rule edits between sessions

After reviewing rules at handoff creation, capture a new baseline:

```sh
npx handoff-check@0.3.1 snapshot --task "Resume migration review" --output handoff.next.json
npx handoff-check@0.3.1 verify --handoff handoff.next.json --require-content --format json
```

Snapshot creates a new file exclusively. Review it before deliberately replacing
the configured handoff file with it. On resume, verify the SAVED handoff first;
never regenerate it just to clear findings.

V2 references record each rule's ID, revision and canonical SHA-256 content hash.
An edit under the same ID is detected even if revision was not incremented.
Revision changes (including decreases) are compared separately.

```text
CHANGED      C-07  Review changed constraint: ...; handoff revision 1, current revision 1; content hash differs
```

JSON findings include expected/reported revision and hash. This detects a change;
it does not show a text diff or authenticate either file. Source reference text is
hashed, but referenced documents are not fetched or checked.

See the [v2 handoff schema](schemas/handoff.v2.schema.json),
[v2 manifest schema](schemas/constraints.v2.schema.json), and
[canonicalization contract](docs/decisions/0002-content-aware-handoffs.md).
The [changed-rule example](examples/changed-rule/handoff.json) captures the original
manifest; its current manifest edits the description without bumping revision.

## Upgrade from 0.1

V1 handoffs remain supported in ID-only mode with unchanged v1 JSON result fields.
They cannot detect content edits. `--require-content` rejects them instead of
silently falling back. V2 handoffs work with either v1 manifests (implicit revision `1`)
or revisioned v2 manifests. Scope must match the v2 handoff's saved scope.

Review current rules, capture a new v2 baseline, and deliberately update the saved
handoff. Existing inputs are preserved by init, not silently upgraded. Review
installed skills, instruction blocks and CI commands to update their pinned
version to 0.3.1 and add `--require-content`. Init refuses to overwrite differing
integrations; compare them with the new packaged templates and update reviewed
copies explicitly. Never refresh before checking resumed work or reuse capturedAt
as the clock for real resumed work.

## Configuration and initialization

`verify` reads only `.handoff-check.json` in the current directory by default,
without searching parents. Missing implicit config falls back to default input
names, but scope is still required. Explicit `--config <path>` must exist.

```json
{
  "schemaVersion": 1,
  "constraints": "constraints.json",
  "handoff": "handoff.json",
  "scope": "staging"
}
```

Configured paths resolve from the config directory. Explicit `--constraints` and
`--handoff` paths resolve from cwd and override config; `--scope` overrides saved
scope. Clock/format remain CLI-only. See [config schema](schemas/config.v1.schema.json).

`init` preserves valid existing inputs/config, appends only its managed block to
agent instructions, and is idempotent. Conflicting skills or managed blocks,
overlapping paths, and symlink output paths are rejected before writes. Existing
config must specify scope; changing init scope requires explicitly editing config.
Custom init input paths must stay inside the project; verify can read external
configured files. Path collisions are checked conservatively across letter case
to support filesystems with case-insensitive names.

`--dry-run --format json` shows exact proposed changes without writes. Init is not
a filesystem transaction: permission/disk/concurrent-write errors can leave partial
output, reported in the error. Inspect it before retrying; do not initialize the
same project concurrently. Verification remains read-only.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Bun 1.2.10 is used in CI. Build output runs on Node.js 22 or newer. The package
name is `handoff-check`; release operations use reviewed artifacts and trusted
publishing as described in [the release guide](docs/releasing.md).

## Try the reproducible demo

From the repository root:

```sh
bun run dev verify --constraints examples/stale-handoff/constraints.json --handoff examples/stale-handoff/handoff.json --scope staging --as-of 2026-11-23T09:00:00Z
```

The synthetic Friday freeze has expired and the migration review rule is missing:

```text
EXPIRED      C-02  Remove expired constraint: Staging freeze ended Friday at 18:00 UTC
MISSING      C-07  Include active constraint: Require review before applying migrations
FAIL  1 active constraints checked | 2 findings | scope staging | as of 2026-11-23T09:00:00.000Z | IDs only; content changes not checked
```

This command intentionally exits with code 1. Use the corrected handoff to pass:

```sh
bun run dev verify --constraints examples/stale-handoff/constraints.json --handoff examples/stale-handoff/corrected-handoff.json --scope staging --as-of 2026-11-23T09:00:00Z
```

```text
PASS  1 active constraints checked | 0 findings | scope staging | as of 2026-11-23T09:00:00.000Z | IDs only; content changes not checked
```

For the built CLI, run `bun run build`, then replace `bun run dev` with
`node dist/cli.js`. If registry installation is unavailable, use a local source
build or tarball.

## Input contracts

The manifest describes reviewed rules:

```json
{
  "schemaVersion": 1,
  "constraints": [
    {
      "id": "C-07",
      "scope": "staging",
      "description": "Require review before applying migrations",
      "source": "docs/decisions/migration-review.md"
    }
  ]
}
```

The handoff records the IDs being carried forward:

```json
{
  "schemaVersion": 1,
  "task": "Resume migration review",
  "activeConstraints": ["C-07"]
}
```

Optional lifecycle fields are `expiresAt`, `revokedAt`, and the pair `replacedBy`
with `supersededAt`. UTC timestamps end in `Z`; transitions apply at the exact
timestamp. Global rules apply to every scope. Replacements must reference existing
rules in the same scope and cannot form cycles.

See [manifest schema](schemas/constraints.v1.schema.json),
[handoff schema](schemas/handoff.v1.schema.json), and
[lifecycle decisions](docs/decisions/0001-constraint-lifecycle.md). JSON Schema covers
structural validation; the CLI also validates calendar dates, unique manifest IDs,
and replacement relationships. Verification never updates these files.

## CLI and automation

```text
handoff-check verify --scope <scope>
  [--config <path>]        default: cwd/.handoff-check.json, when present
  [--constraints <path>]   default: constraints.json
  [--handoff <path>]       default: handoff.json
  [--as-of <UTC time>]     default: current time, captured once
  [--format text|json]     default: text
  [--require-content]      require a v2 content-aware handoff
  [--require-active]       fail when no active constraints apply

handoff-check snapshot --task <task>
  [--config <path>] [--constraints <path>] [--scope <scope>]
  [--as-of <UTC time>] [--output <new-file>] [--format text|json]

handoff-check init --scope <scope>
  [--agent codex|claude|both|none] [--dry-run] [--ci] [--format text|json]
```

Snapshot writes v2 JSON to stdout unless `--output` creates a new file. Its
`--format` option controls the saved-file acknowledgement when an output path is
used. The two `--require-*` policies and `--handoff` are verify-only. Run
`handoff-check --help` for the complete option list.

The same inputs, scope, and time produce the same output. Use `--as-of` for
reproducible CI checks. Explicit CLI paths resolve from the current working directory;
configured paths resolve from the config file's directory.
Scope names and IDs are case-sensitive; arbitrary scope names are accepted and
include global rules even when no scope-specific rules exist.

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| 0         | Verification succeeded, including requested policies       |
| 1         | Rule or active-set policy mismatch; inspect findings       |
| 2         | Invalid arguments, invalid input, or unreadable input file |

Per-rule findings include `MISSING`, `EXPIRED`, `REVOKED`, `SUPERSEDED`, `OUT_OF_SCOPE`,
`UNKNOWN`, and (for v2) `CHANGED`, ordered by ID. A reported ID receives one primary finding according to
the precedence in the lifecycle ADR.

`--format json` writes a versioned result with `status`, `scope`, `asOf`,
`expectedConstraints`, `reportedConstraints`, and `findings` to stdout. Input errors
go to stderr and use `status: "invalid"` when JSON mode has been parsed. Argument
parsing failures may be text. `--help` prints usage text and exits 0.

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md),
[architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and
[release operations](docs/releasing.md).

## Coding-agent adapters

Use the same portable skill with Claude Code or Codex. See the
[installation and usage guide](docs/agent-integration.md). It calls this CLI and
does not maintain a separate verification engine. Installing the skill is optional;
the verifier works independently of either agent.

## Limits

A pass confirms declared IDs match the manifest for the selected scope and time.
It does not validate free-text meaning, authenticate the manifest or its sources,
or grant permission to perform an action.

## License

MIT. See [LICENSE](LICENSE).
