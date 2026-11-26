# Project binding, explicit profiles and reports

Requires Handoff Check 0.6.0+. Existing unbound workflows require no data migration.
Node.js 22+ remains sufficient; verification has no network or model dependency.

## Bind reviewed files to a portable project label

Use a stable case-sensitive identifier such as `payments-api`. Upgrade every
consumer before adopting manifest v3 and handoff v4; older CLIs reject these formats.

1. Verify the existing saved baseline first and resolve/review findings.
2. Deliberately change the reviewed manifest to schemaVersion 3, add projectId,
   and keep positive revisions on every rule.
3. Capture a NEW reviewed baseline. Bound manifests automatically capture v4;
   --include-content optionally retains old text as before.
4. Review/adopt it and optionally set expected projectId in config v2.

Example manifest:

```json
{
  "schemaVersion": 3,
  "projectId": "payments-api",
  "constraints": [
    {
      "id": "MIGRATION-REVIEW",
      "revision": 1,
      "scope": "staging",
      "description": "Require review before staging migrations",
      "source": "synthetic:migration-policy"
    }
  ]
}
```

A bound manifest requires a matching bound handoff; mixing with unbound files or
another project returns exit 2. Rule content hashes do not change just because a
project label is added. Worktrees share the reviewed project ID but use their own
local config/input paths. The ID is not a signature, inferred Git remote, proof
that a directory is trustworthy, or deployment permission.

## Select environments explicitly

Author `.handoff-check.json` as config v2:

```json
{
  "schemaVersion": 2,
  "projectId": "payments-api",
  "constraints": "constraints.json",
  "profiles": {
    "stage": { "scope": "staging", "handoff": "handoffs/staging.json" },
    "prod": { "scope": "production", "handoff": "handoffs/production.json" }
  }
}
```

```sh
npx handoff-check@0.8.0 explain --profile stage
npx handoff-check@0.8.0 snapshot --profile stage --task "Review staging work" --output handoffs/staging.reviewed.json
npx handoff-check@0.8.0 verify --profile stage --require-content
npx handoff-check@0.8.0 doctor --profile stage
```

These assume you deliberately adopted a baseline at the configured handoff path;
snapshot does not adopt or overwrite it. Create parent directories before output.
Profiles require scope; omitted paths inherit top-level values then defaults.
Paths resolve from config location, not from the invocation subdirectory.
Use --config for an explicit config elsewhere.

There is no default/remembered profile. Without --profile, ordinary top-level
scope/path behavior applies; a profile-only config therefore needs explicit
selection. Combining --profile with --scope/--constraints/--handoff is rejected.
Profiles never infer authorization from a branch, folder or the name `prod`.
Init stays unchanged; configure profiles and CI commands through reviewed edits.

For the opt-in Claude adapter, generate with
`hook-config --host claude --profile stage`. Merge the snippet while preserving
existing settings, install the pinned local package, and confirm host delivery.
The existing advisory/error/time bounds remain unchanged. Unknown/mismatched
bindings produce NOT VERIFIED context; hook transport success is not a pass.

## Record exactly what was checked

```sh
npx handoff-check@0.8.0 verify --profile stage --require-content --report --format json
npx handoff-check@0.8.0 verify --profile stage --require-content --report --git-context --format markdown
```

--report is optional and verify-only. It adds package version, requested policies,
selected profile/project and exact input/config byte digests around the existing
result. --git-context separately requests invocation-worktree/commit/branch data;
detached branches are null. Git is not consulted otherwise. Unborn/nonrepo/missing
Git returns 2 without a successful report. No dirty-state claim is made.

Absent implicit config is null. Digest bytes are the SAME read used for parsing,
not a later read that could describe different contents. Raw file whitespace affects
these digests; the existing canonical rule hash still ignores JSON formatting.
The nested result keeps its schema (1/2/3, or 4 for bound handoffs). Default JSON
without --report is unchanged. Verification mismatches still exit 1, invalid inputs
exit 2, and reports go to stdout. Use a separate destination for shell redirection,
never a manifest/handoff/config path.

Review path, branch and project disclosures before sharing a report. This is not
an authenticated attestation or proof of agent compliance. Git metadata and the
separate input reads are not atomic; re-run verification before acting.

## Reproducible repository example

```sh
node dist/cli.js verify --config examples/project-profiles/config.json --profile stage --require-content --report --format json --as-of 2026-11-25T08:00:00Z
node dist/cli.js verify --config examples/project-profiles/config.json --profile prod --require-content --report --format markdown --as-of 2026-11-25T08:00:00Z
```

Both examples are synthetic and pass with their separately reviewed scoped files.
See [ADR 0006](decisions/0006-project-profiles-and-reports.md),
[config v2 schema](../schemas/config.v2.schema.json),
[manifest v3](../schemas/constraints.v3.schema.json),
[handoff v4](../schemas/handoff.v4.schema.json) and
[report wrapper](../schemas/report.v1.schema.json).
