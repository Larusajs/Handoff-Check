# Agent integration

One portable [handoff-check skill](../skills/handoff-check/SKILL.md) supports both
Codex and Claude Code by calling the same CLI. It neither reads transcripts nor
infers rules from a summary.

## Registry installation

From the consuming repository root:

```sh
npx handoff-check@0.10.0 init --scope staging --agent both --dry-run
npx handoff-check@0.10.0 init --scope staging --agent both
```

Choose `codex`, `claude`, `both` (default), or `none`. Generated integrations:

| Agent       | Skill                                   | Instruction file |
| ----------- | --------------------------------------- | ---------------- |
| Codex       | `.agents/skills/handoff-check/SKILL.md` | `AGENTS.md`      |
| Claude Code | `.claude/skills/handoff-check/SKILL.md` | `CLAUDE.md`      |

Review and commit generated files. `--dry-run` previews all changes. Existing valid
inputs and surrounding instruction text are preserved; conflicts fail before
writes. Starters have zero rules: author reviewed constraints and populate handoff
references through a reviewed snapshot before relying on verification. Follow
[your first real check](first-check.md) for a complete example.

## Local contributor package

From this source checkout, with Bun installed:

```sh
bun install --frozen-lockfile
bun run check
npm pack
```

From a separate consuming project, substitute the actual absolute tarball path:

```sh
npx --offline --yes --package=/absolute/path/handoff-check-0.10.0.tgz handoff-check init --scope staging --agent both
npx --offline --yes --package=/absolute/path/handoff-check-0.10.0.tgz handoff-check verify --format json --require-content
```

Bun is not required for these consumer commands. Generated agent commands use the
pinned registry package. To test an unpublished contributor build, use the same tarball invocation or
`node /absolute/path/Handoff-Check/dist/cli.js` in your local agent test prompt.
A local tarball does not make its npm name available in the public registry.

## Agent workflow

```text
Resume this task. Use the handoff-check skill before continuing, verify the
repository's configured scope using the current time, and report findings.
```

The agent checks IDs and reads active rule descriptions. Exit 1 means mismatch;
exit 2 means invalid inputs/arguments. Resolve either before resuming affected work.
A pass does not authorize an action or interpret the task summary.

In 0.2, skills and generated instructions require content-aware v2 handoffs.
At handoff creation, review current rules and run the configured CLI's
`snapshot --task "Resume the task" --output handoff.next.json`. Review that file
before explicitly promoting it to the configured handoff. On resume, verify the
saved baseline first; do not regenerate it to hide a CHANGED finding. Snapshot
records revisions/hashes by default, and capturedAt is not the evaluation clock.
0.4 optionally retains old text in v3 with explicit `--include-content` at reviewed
capture time. This copies full rule content into the handoff: review sensitive
data before committing/sharing. Default v2 capture is unchanged; upgrade every
consumer before adopting v3. Both v2 and v3 satisfy `--require-content`.
Use `explain` for applicability diagnostics and `verify --format markdown` for
review reports; explain exit 0 does not verify a handoff. See the
[explainability guide](explainability.md).

Existing v1 inputs are preserved. Review/capture a v2 handoff and explicitly update
old skill/managed-block/CI pins before relying on content tracking. Existing v1
manifests use implicit revision 1; v2 manifests make revisions explicit.
See [upgrade instructions](../README.md#upgrade-from-01).

Skill discovery depends on the host agent. Skills/instructions are guidance, not
guaranteed hooks. `init --ci` adds `.github/workflows/handoff-check.yml` pinned to
the installed version and using saved config. This checks committed IDs on push/PR,
not every agent turn. 0.5 adds a separate opt-in Claude advisory lifecycle adapter.
See [setup and host limits](lifecycle.md) for doctor diagnostics and explicit local
installation. Codex/Cursor adapters are not shipped.

## Upgrades and contributor instructions

In 0.3, verification reports how many selected/global rules are active. V2 JSON
includes activeConstraintCount. Empty checks remain valid by default but text
clearly says PASS (EMPTY). Agents must not present this as real policy coverage.
Teams can explicitly add --require-active to verify/CI after authoring rules;
zero then exits 1 with a global NO_ACTIVE_CONSTRAINTS finding. New starter CI does
not enable this policy automatically. V1 default JSON remains unchanged.

Matching integrations are preserved on repeated init. If a skill or managed block
differs, compare it to the new package and review/update explicitly; there is no
force-overwrite mode. Commands stay pinned until a reviewed upgrade.

See [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md), and
[development coordination](development.md) for developing Handoff Check itself.
