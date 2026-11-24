# Agent integration

The portable [handoff-check skill](../skills/handoff-check/SKILL.md) works as a
thin adapter for Codex and Claude Code. Both use the same local CLI and JSON
contracts. The adapter does not read transcripts, generate constraints, or modify
manifests automatically.

## Install the CLI from this source checkout

The package is not published to a registry yet. With Bun installed, from this
repository root:

```sh
bun install --frozen-lockfile
bun run check
npm pack
npm install --global ./larusajs-handoff-check-0.1.0.tgz
handoff-check --help
```

Alternatively, configure the agent to invoke `node /absolute/path/to/Handoff-Check/dist/cli.js`
after building this checkout. Run verification from the repository containing the
target handoff, or pass absolute input paths. A source build requires Bun;
execution of the packaged CLI requires only Node.js 22 or newer.

## Install the skill into a target repository

Copy the entire `skills/handoff-check` directory from this project into the
appropriate location in the repository where the agent works:

| Agent       | Target directory                |
| ----------- | ------------------------------- |
| Codex       | `.agents/skills/handoff-check/` |
| Claude Code | `.claude/skills/handoff-check/` |

Install into both locations if the team uses both agents. Keep each installed copy
in sync with its reviewed upstream version. This project keeps one portable skill
source rather than two diverging verification procedures.

Invoke the installed skill explicitly with a request such as:

```text
Use the handoff-check skill before resuming this task. Verify constraints.json
against handoff.json for scope staging, using the current time. Report findings.
```

Skill discovery and loading depend on the host agent. This is an instruction
adapter, not an enforced hook: installing it alone does not guarantee every task
will run the check. For enforcement, invoke the CLI explicitly in the team's
workflow and act on its exit code.

## Contributor workflow

The instructions for developing Handoff Check itself live in [AGENTS.md](../AGENTS.md)
and [CONTRIBUTING.md](../CONTRIBUTING.md). They are distinct from the user-facing
handoff verification skill. See [development coordination](development.md) for
shared-checkout roles and review gates.
