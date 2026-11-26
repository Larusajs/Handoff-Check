# Architecture

Handoff Check compares declared handoff IDs against a reviewed local manifest for
one scope at one instant. It complements task summaries rather than generating or
interpreting them.

The CLI owns argument parsing, local file I/O, clock capture, rendering, and exit
codes. Validation rejects malformed contracts before verification begins. The
pure core receives validated objects, an explicit scope, and an explicit time.

Explain uses the same lifecycle classifier as verification, without consuming a
handoff. Optional v3 snapshots retain validated old content for field-level diffs;
default snapshots remain v2. Pure renderers provide text and Markdown output.
See decisions/0004-explainable-verification.md for contracts and compatibility.

No verification operation writes inputs, accesses a network, calls a model,
executes source references, or reads agent transcripts. Output order must be
independent of manifest and handoff ordering.

Bound input formats compare explicit project IDs in the pure core. Config v2
profiles are selected explicitly in the CLI and shared with doctor/lifecycle.
Optional report metadata hashes the SAME byte reads used to parse inputs/config.
Git subprocesses are fixed-argument, read-only, bounded and separately opt-in for
reports; the verifier itself never reads Git. See ADR 0006 for non-atomicity and
authentication limits.

Doctor inspects local inputs/integration metadata without executing host commands.
The bounded Claude lifecycle adapter reads an event envelope and explicit config,
then calls the same verifier. Hook-config prints a mergeable snippet, never writes
host settings. Advisory host transport success is distinct from verification.
See decisions/0005-local-diagnostics-and-lifecycle.md.

Diff compares two validated saved handoffs without config, manifest, clock or
lifecycle inference. Setup authors new bound files from explicit answers using
the existing parsers and snapshot core, previews exact bytes, and creates files
exclusively only after adoption. Existing init remains stable. See ADR 0007.

Run is an opt-in CLI process adapter: it reads regular local inputs through the
same selectors/parsers, requires current-clock content/nonempty verification,
then spawns explicit argv with shell false only on success. Child stdio/cwd/env
are inherited and exit codes preserved. It never expands the pure verifier into
an execution engine. See ADR 0008 for cancellation, time-of-check/time-of-use and
platform limits; the supplied program's side effects are outside verification.

Review maintenance is independent of verification. A strict separate registry
binds ownership/deadlines to existing rule references; review reuses explain's
active selection and never modifies applicability. Review-record explicitly
captures selected active references without merging or refreshing handoffs.
Neither verify/run nor lifecycle/doctor load the registry. See ADR 0009.

Exit codes: 0 for verified IDs, 1 for rule mismatches, 2 for invalid input or an
unreadable input file. JSON output is intended for agent adapters and automation.

See decisions/0001-constraint-lifecycle.md for lifecycle and scope semantics.
