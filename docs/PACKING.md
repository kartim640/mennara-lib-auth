# Packing `@mennara/auth` for vendoring

Apps install this package from a tarball committed under their own `vendor/` folder, not from a sibling directory
or a registry. This follows the `@mennara/http` procedure (`docs/PACKING.md` in `mennara-lib-http`). This file is
not part of the tarball.

## Build a tarball

```bash
git checkout <commit>            # a commit on main; the tree must be clean
pnpm install --frozen-lockfile
pnpm verify:deps
node scripts/pack-tarball.mjs <empty-output-dir>
```

The script refuses a tree with tracked changes, runs `pnpm pack` (`prepack` rebuilds `dist`), and writes the tarball
plus `<tarball>.provenance.json`. It fails unless:

- the tarball holds only `package.json`, `README.md`, `CHANGELOG.md` and `dist/` (no `vendor/`, no `node_modules`);
- every export (`.`, `./identity`) has a non-empty JavaScript file and declaration file;
- the packed `dependencies` are exactly `{"@mennara/http": "file:vendor/<file from vendor/manifest.json>"}`, with no
  bundled dependencies;
- `dist` imports `@mennara/http` as an external module and contains none of its code.

Edits to `package.json`, `README.md` or `CHANGELOG.md` change the tarball: they are inside it.

## Provenance entry

```json
{
  "name": "@mennara/auth",
  "version": "0.0.0",
  "file": "mennara-auth-0.0.0.tgz",
  "sha256": "<hex of the .tgz>",
  "integrity": "sha512-<base64 of the .tgz>",
  "tarSha256": "<hex of the uncompressed tar>",
  "entries": ["package/CHANGELOG.md", "..."],
  "exports": [".", "./identity"],
  "dependencies": { "@mennara/http": "file:vendor/mennara-http-0.0.0.tgz" },
  "source": { "commit": "<full 40-character commit of this repository>" },
  "build": { "node": "v22.22.3", "pnpm": "10.29.2", "os": "linux-x64" }
}
```

| Field | Use |
|---|---|
| `sha256`, `integrity` | Exact installation pins for the vendored `.tgz`. `integrity` is what pnpm writes into the app lockfile. |
| `tarSha256` | Cross-platform content comparison: the uncompressed tar, hashed with Node's built-in `zlib`. |

Compressed `.tgz` hashes can differ between Node/zlib builds even when the content is identical. A rebuild on another
machine is compared by `tarSha256`, never by `.tgz` hash. The canonical `.tgz` is the one built by the Linux CI job.

## What the hashes do and do not prove

- They prove the tarball has not changed since it was recorded.
- They do not prove which source produced it. That rests on `source.commit` plus an independent rebuild compared by
  `tarSha256`. CI in an app cannot do that rebuild (private repository, no tokens); a reviewer does it before
  approving a vendoring change.

## App requirements

The packed `package.json` declares `"@mennara/http": "file:vendor/mennara-http-0.0.0.tgz"`. pnpm 8.15.1 and 10.29.2
resolve that path against the installing app's root, not against this tarball (tested; see `vendor/README.md`). An app
that vendors `@mennara/auth` must therefore also vendor the same `@mennara/http` tarball at
`vendor/mennara-http-0.0.0.tgz`, with the hashes in this repository's `vendor/manifest.json`. A missing file fails the
install; it never falls back to a registry.

## Reproducibility check in CI

The `pack-reproducibility` job in `.github/workflows/ci.yml` runs on Linux with Node 22.22.3 and the pnpm version in
`package.json`. It verifies the vendored dependencies, packs three times (same tree, same tree after removing `dist`,
and a separate `git archive` extraction in another directory) and fails unless both the `.tgz` SHA-256 and the
`tarSha256` are equal for all three. It does not compare against a fixed hash, because any source change
legitimately changes the tarball.

## Downloading the canonical artifact

A successful push to `main` uploads the Linux tarball and its provenance JSON as the artifact
`mennara-auth-canonical-<commit>` (retention 7 days; pull requests never upload). Before upload the job recomputes the
`.tgz` SHA-256, the SHA-512 integrity and the tar SHA-256, and checks them, the tarball entries and `source.commit`
against the provenance file and `GITHUB_SHA`.

```bash
gh run download <run-id> --repo kartim640/mennara-lib-auth -n mennara-auth-canonical-<commit>
```

Take the `.tgz` out of the artifact ZIP and compare its three hashes with the provenance JSON before vendoring it.
