# Installation diagnostics and lifecycle checks

Requires Handoff Check 0.6.0+ and Node.js 22+. Checks run locally without model
calls, source fetches, API keys or transcript access.

## Diagnose the intended repository/worktree root

```sh
npx handoff-check@0.12.0 doctor --format json
npx handoff-check@0.12.0 doctor --host claude
```

Doctor reports resolved input paths/versions, managed integrations/pins and
recognized project hooks without executing them. Config/path/scope overrides work
as with verify. Exit 0 means no local attention found, 1 means warnings/errors,
and 2 means invalid invocation. It does not verify applicability or prove hooks
ran. Empty starters get a coverage warning. Older pins/skills need explicit review;
init still refuses conflicting integrations. Custom, user/global/local/enterprise
host settings and effective trust are not comprehensively inspected.

## Opt in to Claude Code lifecycle checks

1. Initialize/review inputs and deliberately adopt a content-aware baseline.
2. Install the exact package in the consuming project. For npm:
   `npm install --save-dev --save-exact handoff-check@0.12.0`. Installation uses
   the registry; the hook later uses only this local package. Temporary npx caches
   and global installs do not meet that prerequisite.
3. Run `npx handoff-check@0.12.0 hook-config --host claude` and inspect the JSON.
4. In an editor, merge the returned SessionStart entries into the existing
   `.claude/settings.json` hooks object. Preserve other events, handlers,
   permissions and settings. Do not replace the whole file or blindly redirect
   stdout onto it. The generator writes no files.
5. Run doctor; confirm the entry in Claude's `/hooks` and host debug output, then
   test startup/resume/compact delivery before relying on it.

The snippet uses documented exec-form node/args and CLAUDE_PROJECT_DIR placeholders.
Use a current Claude Code version supporting that interface. Each path is a
separate argument, including paths with spaces/metacharacters. Every linked
worktree needs its own local package/config and correct host project root.
Payload cwd must canonicalize inside the explicit config directory; subdirectories
are allowed, other worktrees are rejected. No upward discovery occurs.

The adapter requires v2/v3/v4 content tracking and uses the current clock. Generate
with `hook-config --host claude --require-active` only when explicitly requiring
a nonempty active set. Neither mode writes/captures a baseline.

Host context shows pass, empty pass, mismatch or invalid inputs. Transport exit 0
means a host response was produced, not necessarily verification passed. Malformed
events/timeouts return 2; SessionStart errors do not block work. Descriptions/source
text are not injected as instructions. Re-run verify for full findings.

## Host capabilities

| Host            | CLI | Skill                  | Lifecycle adapter in 0.5                  | Limits                                                                                |
| --------------- | --- | ---------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------- |
| Claude Code     | Yes | Yes                    | SessionStart startup/resume/clear/compact | Advisory; fork/action-blocking hooks not provided. Confirm host loading manually.     |
| Codex           | Yes | Yes                    | Not shipped                               | Hooks/trust/worktree interfaces documented, but no adapter certified in this release. |
| Cursor          | Yes | No dedicated installer | Not shipped                               | Own hooks/third-party compatibility exist; not certified here.                        |
| Other agents/CI | Yes | Manual portable use    | Not shipped                               | Invoke CLI explicitly and preserve exit codes.                                        |

Reviewed 2026-11-25: [Claude](https://code.claude.com/docs/en/hooks),
[Codex](https://learn.chatgpt.com/docs/hooks), [Cursor](https://cursor.com/docs/hooks).
Tests exercise protocol fixtures and generated Node commands. Live host/model
context delivery is a separate check, not implied by fixture tests. Host/user/
enterprise policies can disable hooks or require review.

## Critical actions need a fresh check

From 0.8.0, use the dedicated command wrapper with the reviewed local package:

```sh
node ./node_modules/handoff-check/dist/cli.js run --profile production -- node scripts/preflight-demo.js
```

Choose a configured profile and explicit reviewed program. The wrapper requires
nonempty content-aware inputs and the current clock, then preserves the child
result. It blocks only commands invoked through it, not other agent actions.
See [verified commands](verified-commands.md) for timing, process and platform limits.

In Bash with the project-local package already installed:

```sh
node ./node_modules/handoff-check/dist/cli.js verify --require-content --require-active --format json
VERIFY_EXIT=$?
if [ "$VERIFY_EXIT" -ne 0 ]; then
  exit "$VERIFY_EXIT"
fi
# The team's independently reviewed deployment step follows here.
```

CI shells with fail-fast already stop on a nonzero verifier result. Keep report/
upload steps from masking that failure. Choose scope explicitly. Verification
checks declared constraints, not credentials, semantic enforcement or action
authorization; files can still change after a check. Retain normal isolation and
approval controls.

## Troubleshooting

- Missing local package: install the reviewed version in this worktree, rather
  than replacing the hook with an unpinned network download.
- NOT VERIFIED: run doctor and verify; fix inputs without refreshing a baseline
  merely to hide findings.
- No context: inspect /hooks, disabled/managed settings, Node availability,
  exec-form support and CLAUDE_PROJECT_DIR for this worktree.
- Wrong event/cwd: use the generated matcher/config. Fork/other events need explicit
  verification in this release.
- Input/output limits: envelopes are capped at 64 KiB/2 seconds; the whole check
  has a 5-second watchdog. Truncation directs you to complete verify findings.

See [ADR 0005](decisions/0005-local-diagnostics-and-lifecycle.md) for exact contracts.
