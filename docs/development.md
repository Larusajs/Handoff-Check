# Development coordination

Use focused feature branches and reviewable commits. A small team can divide work
into the following roles without duplicating implementation:

| Role           | Responsibility                                                  | Shared-checkout permissions                    |
| -------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| Lead developer | Architecture, implementation, fixes, integration                | Owns source edits                              |
| QA             | Acceptance scenarios, CLI/process checks, reproducible failures | Read-only; temporary fixtures outside the repo |
| Reviewer       | Independent correctness and contract review                     | Read-only; reports actionable findings         |
| Git owner      | Commit grouping, detailed messages, branch/PR hygiene           | Git writes after the lead confirms readiness   |

Names are roles, not a requirement to run four agents for every change. A solo
contributor can perform them sequentially. For simultaneous implementation, use
isolated checkouts and assign disjoint responsibilities.

## Review gates

1. The lead identifies the changed behavior and completes implementation.
2. QA reports observed commands, expected nonzero exits, results, and remaining
   coverage gaps. Review reports findings with severity and reproduction steps.
3. The lead fixes actionable issues and requests targeted revalidation.
4. Once required checks pass and blocking findings are resolved, the Git owner
   re-reads the final diff, including untracked files, and creates coherent commits.
5. A PR describes the final behavior, actual validation, and compatibility impact.

Do not claim that checks ran on hosted CI based only on local results. Do not
change branches while another contributor is editing the shared checkout. Keep
machine-specific terminal handles and runtime identities out of committed docs.

Publication is separate from source development. Before a first release, review
the package identity, version, license, included files, install behavior, changelog,
and the CI results. Registry publication requires explicit authorization.
