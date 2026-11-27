# Snapshot comparison and guided setup

## Start a new project interactively

With Node.js 22 or newer, run in the intended project root:

```sh
npx handoff-check@0.10.0 setup
```

Enter a portable project ID, comma-separated environments, a rule ID, a real rule
that applies to **all** those environments, its source reference, and a task.
Source references are stored as text and never fetched. Setup prints the exact
config v2, bound manifest v3, and retained v4 baseline for each environment. Full
rule descriptions and sources are retained: review sensitive content before
committing or sharing the files. Type `yes` only after reviewing and adopting them.
Any other answer cancels without writes. Ctrl-C/EOF before approval fails with
exit 2 and no writes. `setup --dry-run` asks the same questions and previews without
asking for adoption or writing files. Captured time is fixed once for that plan;
it is informational, not an evaluation time to reuse on resume.

Setup requires an interactive stdin/stdout terminal. It never installs packages,
agent skills, hooks, CI or host settings. Existing config, manifest or generated
handoff paths (including symlinks) cause refusal before writes. It is deliberately
new-project-only; rerunning refuses existing files rather than refreshing them.
Writes use exclusive creation and are not transactional: an I/O failure lists
already written paths. Inspect those files before retrying.

For environments `staging,production`, setup creates `.handoff-check.json`,
`constraints.json`, `handoff-staging.json`, and `handoff-production.json`. There
is no default profile. Choose the intended environment explicitly:

```sh
npx handoff-check@0.10.0 verify --profile staging --require-content --require-active
```

Add environment-specific rules later through deliberate review and capture;
the first global rule is authored by you, never inferred. For automation use
`init --scope <scope> --agent none` instead; it retains its existing unbound,
zero-rule starter behavior. For existing bound/profile projects, edit and review
integration files explicitly using [lifecycle setup](lifecycle.md) and the shipped
portable skill. Do not use setup as a migration or baseline-repair command.

## Compare two saved snapshots

```sh
npx handoff-check@0.10.0 diff --before handoff.saved.json --after handoff.next.json
npx handoff-check@0.10.0 diff --before handoff.saved.json --after handoff.next.json --format json
npx handoff-check@0.10.0 diff --before handoff.saved.json --after handoff.next.json --format markdown
```

Both operands are strictly validated handoff files. Unbound v2/v3 can be compared
to each other; bound v4 can compare hashes/retained modes within the same project.
Legacy v1, mixed bound/unbound, different projects and different scopes fail with
exit 2. The command accepts only `--before`, `--after`, and `--format`; it reads
neither config nor manifest, uses no clock, and accesses no Git/network/agent data.

IDs present only after are ADDED; only before are REMOVED. Same-ID differences in
revision or canonical content hash are CHANGED, even without a revision bump.
Remaining IDs count as unchanged. Output sorts IDs and uses the existing fixed
field order. Hashes are always shown for changed rules. Field details appear only
when both snapshots retain content; a missing optional field is represented as
null. No text is reconstructed from hashes. Reordering, task, capture-time and
retention-mode-only differences do not count as rule changes. The operands set
direction even if their capture times are reversed.

Exit codes: **0** unchanged declarations; **1** rule differences; **2** invalid
arguments/input or unreadable files. JSON uses its own schemaVersion 1 contract
([schema](../schemas/diff.v1.schema.json)), independent of verification results.
`beforeCount`/`afterCount` count declared references, not current active rules.
Removed does not mean revoked, expired, authorized removal, or dropped from agent
memory. This is a comparison of saved declarations. Run verify against the current
reviewed manifest before resuming work; diff is not authorization or compliance proof.
Both commands leave existing inputs intact. Never redirect diff output onto inputs.
