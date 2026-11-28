# ADR 0011: explicit combined project check

Status: accepted for 0.11.0.

A daily check composes existing engines rather than creating a second verifier.
Verification always requires content-aware v2/v3/v4 and a nonempty active set.
Review and source checks require explicit registry paths; an omitted section is
not-requested, never passed. Existing commands and policies stay unchanged.

Validate common invocation/config/profile/manifest/project/scope/time before
emitting a report. Selected role-file read/parse/binding failures instead become
invalid sections, preserving independent valid results. Overall precedence is
invalid (exit 2), attention (1), passed (0). No fake nested result is created for
an invalid section. The independent v1 report includes all three section states,
requested/passed/attention/invalid/not-requested counts and mandatory policies.

The CLI observes each resolved metadata pathname once, including failures and
config aliases, but parses each selected role independently. Capture one clock
after requested metadata reads. Source inspection remains explicit and uses the
existing bounded adapter only after valid metadata/reference selection. No guessed
paths, implicit discovery, writes, execution, network calls or baseline adoption.

This is a non-atomic local report, not permission or authenticated compliance.
A fixed clock selects applicability, not historical bytes. Pilot preparation uses
an observation template; synthetic acceptance and technical smoke checks do not
establish human usability, timing improvements or multi-repository adoption.
