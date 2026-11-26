# ADR 0008: current-clock verification before an explicit command

Status: accepted for 0.8.0.

Session-start checks become stale before later operations. Add an opt-in `run`
CLI adapter that uses existing config/profile selectors, strict input parsers
and the same pure verifier immediately before spawning one explicit executable.
Require content-aware input, a nonempty active set and the current clock; offer
no as-of/force/skip/policy override. Read each input once; never refresh a baseline.
No new manifest/handoff or verification result schema is needed.

Require `run` first and an explicit `--` boundary. Parse only preceding wrapper
options, pass the trailing executable/argv as an array with shell false, and
inherit cwd/environment/stdio. Do not infer the command from config or rules.
Keep stdout available for the child and emit phase diagnostics to shared stderr.
Block mismatch with 1, invalid preflight/launch with 2; preserve all child exit
codes after launch. Signal forwarding is best-effort to a direct child only;
there is no descendant supervision, forced termination or command timeout.
Cancel preflight without launch and bound stalled asynchronous reads with an
event-loop watchdog removed before spawning. Document platform and timing limits.

This narrows the gap between a declared-rule check and an explicitly requested
operation. It is not atomic with file changes, a model compliance check, an
authorization boundary, or a sandbox. The chosen program retains ordinary access
and may itself interpret commands or perform multiple actions. Existing verify,
init, snapshot, diff, setup and advisory lifecycle behavior stay unchanged.

Owner/review-by metadata and explicit source-file checks remain separate future
work: overdue review must not silently deactivate rules, and source edits do not
prove semantic policy changes. Do not bundle them into the command gate.
