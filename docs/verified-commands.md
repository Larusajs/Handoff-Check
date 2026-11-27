# Verify immediately before a command

`run` performs a current-clock verification and starts an explicitly supplied
executable only after a nonempty, content-aware handoff passes. It calls the same
verifier as `verify`; the pure core and existing input formats are unchanged.

With Node.js 22 or newer, use an existing reviewed project configuration:

```sh
npx handoff-check@0.10.0 run --profile production -- node scripts/preflight-demo.js
```

The profile is an example: select the intended configured profile, or use
`--scope <scope>` with optional `--constraints <path>`/`--handoff <path>`.
`--config <path>` selects an explicit config. Config paths resolve relative to
that config, CLI input paths relative to the invocation directory. The child
always inherits the invocation working directory, environment and stdin/stdout/
stderr; selecting a config elsewhere does not move the child. Project/scope
binding and profile override restrictions are identical to verify.

Use a reviewed installed or project-local version for critical workflows so a
network download is not part of each operation. `npx` installation may access the
registry; `run` itself performs no network, Git or model calls. The supplied
program may access networks or mutate files as any normal command can.

## Command boundary and mandatory policy

`run` must be the first CLI argument. A literal `--` separates wrapper options
from the executable and its argv. Everything after it is passed literally,
including `--help`, `--version`, `--profile`, spaces, empty strings and shell
metacharacters. The wrapper uses `spawn` with `shell: false`; it never constructs
a command string or reads an executable from project rules/config.

Only `--config`, `--profile`, `--scope`, `--constraints`, and `--handoff` are
supported wrapper options. `run --help` prints usage without starting a child.
`--as-of`, policy overrides, output/report formats and force/skip modes are not
supported. Content-aware v2/v3/v4 and at least one active constraint are mandatory.
An empty starter that passes ordinary verify therefore cannot start a command.
There is no automatic migration, snapshot refresh, baseline adoption or input edit.

The evaluation clock is captured after input reads, immediately before the pure
verification. Missing/changed/stale declarations produce a blocked result; invalid
JSON, mismatched binding/scope, unsupported legacy v1 and unreadable files fail
without starting the child. A five-second event-loop watchdog bounds stalled
asynchronous preflight reads; it is removed before command launch, not applied as
a runtime limit to the command. Run opens inputs nonblocking and requires regular
files (file symlinks to regular files remain supported); FIFOs/devices/directories
are rejected. The watchdog cannot preempt synchronous JavaScript or guarantee
termination of an unresponsive operating-system/filesystem operation.

Executable lookup uses the inherited PATH; a path containing spaces is one argv
token. On Windows, prefer `node path/to/script.js` or a native executable.
`.cmd`/`.bat` scripts require a command interpreter and have no implicit shell
fallback. An explicitly chosen shell is itself the supplied program; its own
parsing and side effects are the caller's responsibility.

## Diagnostics and exit codes

Wrapper diagnostics go to stderr, leaving stdout for the supplied program:

- `RUN CHECKING`: preflight begun; no child has started.
- `RUN BLOCKED`: mismatch, including finding codes/IDs; exit 1, no child.
- `INVALID` or `RUN INVALID`: invalid invocation/input or stalled preflight;
  exit 2, no child.
- `RUN VERIFIED`: count, scope, evaluation time and optional project/profile;
  verification passed, but launch has not yet been proven.
- `RUN LAUNCH ERROR`: executable could not start; exit 2.
- `RUN STARTED`: spawn succeeded; wait for the program's result.
- `RUN EXIT`: child exit code is preserved, including 1, 2, 42 or 127. After
  launch, codes 1/2 describe the child, not a new verifier finding.

Child stderr shares the same inherited stream and may interleave with diagnostics;
these prefixes are human diagnostics, not an authenticated machine protocol.
No full argv, rule descriptions or source references are printed by the wrapper.
For structured verification details run `verify --format json` separately.

On POSIX, SIGINT/SIGTERM received during preflight cancel with 130/143 and no
launch. While running, forwarding is best-effort to the direct child only. The
wrapper waits for its exit; a handler's chosen exit code wins. An unhandled child
signal maps to 128 plus the OS signal number (unknown signals fall back to 129).
Terminal process groups may deliver a signal to both processes independently.
Windows console/termination semantics differ and POSIX forwarding is not promised.
There is no automatic forced termination, command timeout or descendant cleanup;
a child ignoring a signal can keep running. `RUN PROCESS ERROR` or forwarding
failure diagnostics after launch do not reclassify it as a launch failure.

## Test the gate without running a real operation

In a disposable configured project with a reviewed active baseline:

```sh
npx handoff-check@0.10.0 run --profile production -- node -e 'console.log("example command started")'
```

Edit a rule description in that disposable manifest without refreshing its saved
baseline, then repeat. Expect `RUN BLOCKED CHANGED`, exit 1, and no example output.
Review and resolve the difference explicitly before real work. The command is
never retried automatically.

This is a preflight gate around one explicitly invoked command, not a sandbox,
authorization grant or proof of behavior. Inputs can change or expire after the
check, and the supplied program can perform additional actions or spawn children.
It cannot stop agent actions outside this wrapper. Re-run it per intended action;
a previous pass is not a reusable execution permission.
