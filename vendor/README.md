# Vendored packages

`@mennara/http` is installed from `mennara-http-0.0.0.tgz` in this folder, not from a sibling checkout or a registry.
`manifest.json` records where it came from; `pnpm verify:deps` checks the file, the manifest, `package.json` and
`pnpm-lock.yaml` against each other (add `-- --installed` after `pnpm install`).

- **Source:** the Linux artifact `mennara-http-canonical-<commit>` of `kartim640/mennara-lib-http` CI (`pack-reproducibility`,
  push to `main`). Download it with `gh run download <run-id> --repo kartim640/mennara-lib-http -n <artifact>`, take the
  `.tgz` out of the artifact ZIP, and compare its three hashes with `manifest.json`.
- **Rebuild check:** a reviewer checks out `source.commit`, follows `docs/PACKING.md` in `mennara-lib-http` and compares
  `tarSha256`. The `.tgz` hash only matches a build with the same Node/zlib build.
- **Updating:** replace the `.tgz`, update `manifest.json`, run `pnpm install --lockfile-only`, then `pnpm verify:deps`.

## Consumers of `@mennara/auth`

The packed `package.json` of this library says `"@mennara/http": "file:vendor/mennara-http-0.0.0.tgz"`. An app that
installs `@mennara/auth` from a tarball must therefore also keep that exact file at `vendor/mennara-http-0.0.0.tgz` in
its own root, and its lockfile must pin it. The relative path is resolved against the consuming project, not against
this library; the install fails if the file is missing.
