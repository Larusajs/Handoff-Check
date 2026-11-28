# Releasing

The npm package name is `handoff-check`; the binary is `handoff-check` and the
current version is 0.10.0. The package is already published; subsequent releases
use the configured trusted publisher and the reviewed-artifact process below.

## Release a reviewed version

1. Merge reviewed changes into main and wait for all Linux/macOS/Windows checks,
   including packed offline npx onboarding, to pass on the merged commit.
2. Run the manual **Release package** workflow on main with the exact package
   version and `publish: false`. It repeats the platform matrix and uploads the
   built tarball as `npm-package`.
3. Download that tarball, inspect its file list and checksum, and test it in a
   separate consumer directory using offline npx with an absolute tarball path.
4. Prefer trusted publishing: dispatch the same main commit/version with
   `publish: true` and the reviewed tarball's SHA256 in the `sha256` input. The
   workflow refuses publication if the rebuilt artifact differs. Download the
   publish-run artifact and compare it before claiming artifact continuity.
   For first-publication bootstrap or an explicitly chosen manual release, use
   `npm login` and publish the reviewed tarball directly with
   `npm publish /absolute/path/handoff-check-0.10.0.tgz --ignore-scripts --access public`.
   Complete interactive two-factor authentication directly with npm.
5. Verify registry name, version, binary and integrity, then test
   `npx --yes handoff-check@0.11.0 --version` and fresh-project init/verify using a
   new package cache and the public registry, rather than the local tarball.
6. Create tag `v0.10.0` and a GitHub release on the reviewed main commit, attach the
   same tarball, and describe features, requirements and known limits.

Publishing is immutable for a given npm name/version. Fix failed candidates on a
branch, review, merge and rebuild. Fix published releases with a new version.

## Later releases with trusted publishing

Configure the npm package's trusted publisher for owner `Larusajs`, repository
`Handoff-Check`, workflow `release.yml`, and environment `npm`. Add required
reviewers to that GitHub environment if maintainers want an approval gate.

The manual workflow defaults to artifact-only mode. Selecting `publish: true`
validates main on all supported platforms, builds a fresh artifact for that exact
workflow commit, uploads it, and publishes that artifact with npm OIDC. It does not
reuse an earlier run's artifact or automatically create a GitHub release/tag.
Select the intended reviewed main commit and version before dispatching a release.
No long-lived npm publishing token is required.

Trusted publishing requires npm 11.5.1+ and Node 22.14+; the workflow uses Node 24
and checks the npm version before publishing. See the maintained
[npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

Version updates must keep package.json, bun.lock, changelog and examples current.
Generated agent commands and CI templates use the package metadata version.
Existing integrations are preserved; review their pinned version explicitly when
upgrading.
