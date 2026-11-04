# mennara-lib-auth

`@mennara/auth`: shared auth plumbing for frontends (depends on `@mennara/http`).

Platform docs (read the ones that apply before changing behavior; index: `../../mennara-document/mennara-platform/docs/INDEX.md`):
- `../../mennara-document/mennara-platform/docs/standards/frontend-and-ux.md`
- `../../mennara-document/mennara-platform/docs/standards/frontend-coding.md`
- `../../mennara-document/mennara-platform/docs/architecture/shared-packages.md`
- `../../mennara-document/mennara-platform/docs/overview/current-state/shared-packages.md`

## Checks (same as CI)
- `pnpm install --frozen-lockfile (pnpm@10.29.2)`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm verify, pnpm verify:deps, pnpm verify:dist`

## Repo rules
- Portals install a pinned, hash-checked tarball of this package in their own `vendor/` folder. A change here is live in a portal only after that portal re-vendors it, in its own change.
- Shared packages carry infrastructure and UI, not business logic.
- Version changes go through changesets (`pnpm changeset`).

## Rules
- Spec first: the requirement lives in the platform docs. Change the spec before the code (platform skill `change-spec`).
- The latest owner-confirmed requirement wins. Report conflicts; do not choose silently.
- Merged is not deployed. Do not claim a deploy without evidence.
- Do not commit, push or merge unless asked. Never put secrets in code, logs or tests.
- Finished work is recorded in the platform repo (`record-done`), not here.
