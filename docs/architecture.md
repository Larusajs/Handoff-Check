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

Exit codes: 0 for verified IDs, 1 for rule mismatches, 2 for invalid input or an
unreadable input file. JSON output is intended for agent adapters and automation.

See decisions/0001-constraint-lifecycle.md for lifecycle and scope semantics.
