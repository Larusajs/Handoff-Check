# ADR 0005: Local diagnostics and lifecycle adapters

Status: accepted for 0.5.0. Host references checked 2026-11-25.

## Commands and compatibility

Verify/snapshot/explain and their schemas remain unchanged. Doctor is read-only,
hook-config writes only stdout, and hook invokes the existing pure verifier.
None installs packages, edits host settings, reads transcripts/source references,
calls models, runs arbitrary commands, or recaptures a baseline.

Doctor accepts config/path/scope overrides and optional host claude/codex/cursor.
JSON schemaVersion 1 includes packageVersion, status (healthy/attention), paths,
optional scope, diagnostics and notice. Each diagnostic has code, level
(ok/info/warning/error), message and optional path. Ordering is deterministic for
the same files/options; no applicability clock is used. Exit 0 means no local
warning/error, 1 means diagnosed attention, and 2 means invalid invocation or an
unexpected diagnostic failure. Bad project data are diagnostics on stdout.

Doctor validates input schemas and compares managed skill text/instruction pins
and textual CI pins. It inspects project .claude/settings.json for the recognized
generated handler and checks its local package prerequisite. It never executes
inspected hooks or imports inspected packages. Missing unselected integrations are
informational; selected-host omissions warn. Custom prose/commands, global/local/
managed settings, effective host trust and runtime execution are not inferred.
Symlink input reads follow verify semantics and are identified. No repair occurs.

## Explicit advisory adapter

Hook-config emits a mergeable JSON fragment for Claude SessionStart only. Users
preserve all existing handlers/permissions while merging; no settings are written.
The handler uses exec-form node plus separate args with CLAUDE_PROJECT_DIR
placeholders, avoiding shell evaluation and preserving special characters in paths.
A pinned project-local package and a host supporting this documented exec form
are prerequisites; temporary npx/global installations are insufficient.

The matcher selects startup/resume/clear/compact. Fork and other events are not
supported in 0.5. Timeout is 10 seconds. --require-active is copied only on explicit
request. The adapter always requires content-aware v2/v3; empty checks are valid
and explicitly marked by default.

Hook consumes one JSON envelope from stdin. Required event/source/cwd fields are
validated; extra host metadata is ignored, including transcript_path. cwd must be
an existing absolute directory inside the canonical explicit config directory.
Subdirectories and canonicalized symlink roots work; other worktrees/siblings fail.
The caller selects its worktree config explicitly; no parent search or environment
guessing occurs. Scope comes from saved config and current time is captured once.

Input is bounded to 65536 bytes and a 2-second wait; a CLI watchdog caps the entire
adapter at 5 seconds, including stuck file reads. Output is only
hookSpecificOutput {hookEventName: SessionStart, additionalContext: string}.
Context distinguishes PASS/PASS (EMPTY)/FAIL/NOT VERIFIED (INVALID), with
scope/time/count/finding codes and IDs. Arbitrary descriptions/sources/task text
are not injected as instructions. Summaries mark truncation and point to verify.

Valid envelopes with invalid project inputs still emit NOT VERIFIED and transport
exit 0 so the advisory result reaches context. Invalid envelopes/containment or
config invocation, stream errors and timeouts exit 2 with safe stderr, no success
JSON. SessionStart is nonblocking: transport success is not verification success
or permission to act. No permission/continue/bypass fields are emitted.

## Operational limits

Critical operations re-run verify in their own execution path, independently of
this advisory hook. Permissions/approvals remain separate; files may change after
a check. Protocol fixtures and generated-command subprocess tests do not prove a
particular live host loaded settings or delivered model context. Confirm that
with the host's /hooks/debug surfaces. Other hosts have hook mechanisms, but this
release does not ship/test adapters for those protocols.

References: [Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Cursor hooks](https://cursor.com/docs/hooks).
