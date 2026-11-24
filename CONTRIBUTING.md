# Contributing

Contributions are welcome through issues and pull requests. All project artifacts
and review discussions should be understandable in English.

## Local development

Install Bun, clone the repository, then run:

```sh
bun install --frozen-lockfile
bun run check
```

Bun is the development and test runtime. The built CLI targets Node.js 22 or newer.
Commit bun.lock whenever dependencies change. CI uses a fixed Bun version.

## Changes and reviews

1. Start a focused branch from main (`feat/`, `fix/`, `docs/`, or `chore/`).
2. Describe the problem and expected behavior in an issue or PR.
3. Implement the smallest complete change, updating docs and behavior tests.
4. Run `bun run check` and include results in the PR.
5. Explain compatibility changes and significant design choices.

Use Conventional Commits, with an explanatory body for meaningful changes:

```text
fix(core): expire constraints at the exact expiry timestamp

Treat the expiration boundary as inactive to match the documented contract.
Previously, a freeze could remain active for one extra evaluation instant.

Validation: added before, at, and after expiration tests; bun run check passes.
```

Keep unrelated cleanup out of behavior changes. Do not commit secrets, generated
build output, real handoff transcripts, or private source records. Synthetic
fixtures should reproduce the issue without personal or organization data.

See AGENTS.md for instructions shared by coding agents and human contributors.
