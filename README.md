# Handoff Check

A deterministic, local CLI that verifies active constraints before a coding agent
resumes work.

**Status: under development; not yet published.**

A task summary may preserve the goal while losing an active rule, carrying an
expired restriction, or moving a staging-only instruction into production.
Handoff Check compares the IDs in a handoff with a reviewed, versioned manifest
for the selected scope and time.

No API keys, network calls, model calls, or agent transcript access are required.
Source references are review metadata and are never fetched.

## Development

```sh
bun install --frozen-lockfile
bun run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md), [AGENTS.md](AGENTS.md),
[architecture](docs/architecture.md), and [roadmap](docs/roadmap.md).

## Limits

A pass confirms declared IDs match the manifest for the selected scope and time.
It does not validate free-text meaning, authenticate the manifest or its sources,
or grant permission to perform an action.

## License

MIT. See [LICENSE](LICENSE).
