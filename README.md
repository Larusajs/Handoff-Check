# Handoff Check

A deterministic, local CLI that verifies active constraints before a coding agent
resumes work.

**Status: initial MVP; not yet published.**

A task summary may preserve the goal while losing an active rule, carrying an
expired restriction, or moving a staging-only instruction into production.
Handoff Check compares the IDs in a handoff with a reviewed, versioned manifest
for the selected scope and time.

No API keys, network calls, model calls, or agent transcript access are required.
Source references are review metadata and are never fetched.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

Bun 1.2.10 is used in CI. Build output runs on Node.js 22 or newer. The package
name is provisional until registry availability is checked before publication.

## Try the reproducible demo

From the repository root:

```sh
bun run dev verify --constraints examples/stale-handoff/constraints.json --handoff examples/stale-handoff/handoff.json --scope staging --as-of 2026-11-23T09:00:00Z
```

The synthetic Friday freeze has expired and the migration review rule is missing:

```text
EXPIRED      C-02  Remove expired constraint: Staging freeze ended Friday at 18:00 UTC
MISSING      C-07  Include active constraint: Require review before applying migrations
FAIL  2 findings | scope staging | as of 2026-11-23T09:00:00.000Z
```

This command intentionally exits with code 1. Use the corrected handoff to pass:

```sh
bun run dev verify --constraints examples/stale-handoff/constraints.json --handoff examples/stale-handoff/corrected-handoff.json --scope staging --as-of 2026-11-23T09:00:00Z
```

```text
PASS  0 findings | scope staging | as of 2026-11-23T09:00:00.000Z
```

For the built CLI, run `bun run build`, then replace `bun run dev` with
`node dist/cli.js`. Installation from a package registry is not available yet.

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
  [--constraints <path>]   default: constraints.json
  [--handoff <path>]       default: handoff.json
  [--as-of <UTC time>]     default: current time, captured once
  [--format text|json]     default: text
```

The same inputs, scope, and time produce the same output. Use `--as-of` for
reproducible CI checks. Relative paths resolve from the current working directory.
Scope names and IDs are case-sensitive; arbitrary scope names are accepted and
include global rules even when no scope-specific rules exist.

| Exit code | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| 0         | Declared IDs match the active manifest rules               |
| 1         | Rule mismatch; inspect findings                            |
| 2         | Invalid arguments, invalid input, or unreadable input file |

Findings are `MISSING`, `EXPIRED`, `REVOKED`, `SUPERSEDED`, `OUT_OF_SCOPE`, or
`UNKNOWN`, ordered by ID. A reported ID receives one primary finding according to
the precedence in the lifecycle ADR.

`--format json` writes a versioned result with `status`, `scope`, `asOf`,
`expectedConstraints`, `reportedConstraints`, and `findings` to stdout. Input errors
go to stderr and use `status: "invalid"` when JSON mode has been parsed. Argument
parsing failures may be text. `--help` prints usage text and exits 0.

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md),
[architecture](docs/architecture.md), and [roadmap](docs/roadmap.md).

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
