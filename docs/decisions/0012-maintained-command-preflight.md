# ADR 0012: explicitly selected maintenance before a command

Status: accepted for 0.12.0.

Extend the existing run adapter with explicitly selected review and source
registries. An invocation without those options retains its existing verification
policy, output and process behavior. Selected maintenance is an additional local
preflight, never implicit discovery or permission to act.

Reuse the combined-check engines, parsers and bounded source adapter rather than
launching another CLI or duplicating verification. Preserve literal executable
argv, inherited streams/environment/cwd, the five-second preflight watchdog,
cancellation, direct-child signal limits and child result propagation.

Source reads may cross a lifecycle or review deadline. Evaluate the final launch
decision at a current clock after asynchronous preparation, using the same parsed
metadata and observed bytes. Any selected attention or invalid state blocks the
child. No historical clock, format/output override, recording, adoption or refresh
is added. Initial source selection and final launch evaluation can differ. A clock
rollback or new eligibility needing an uncaptured source observation fails closed
as invalid (exit 2), without another read or a fabricated source pass. Existing
check evaluates at its original selection clock and keeps its 0.11 semantics.

Preparation reads and parses each selected metadata role once through the existing
pathname cache. Synchronous evaluation receives prepared objects, observations and
an explicit clock and calls existing pure engines without parsing or I/O. Any
selected invalid section wins over attention, with bounded section/finding codes
on stderr and no combined stdout. Maintenance never becomes implicit discovery.

This remains a non-atomic preflight, not a sandbox, authentication or compliance
proof. A chosen program retains ordinary access, inputs may change after checking,
and an unchanged file hash does not establish semantic policy validity.
