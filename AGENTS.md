# AGENTS.md

Working agreement for anyone (human or agent) changing this repository.

## Branches

| Branch | Purpose | Direct pushes |
| --- | --- | --- |
| `main` | Production. Always deployable. | **Never** |
| `dev` | Integration. Everything lands here first. | **Never** |
| `feat/<slug>` | A new feature. | Allowed on your own branch |
| `fix/<slug>` | A bug fix. | Allowed on your own branch |

- `main` and `dev` are protected. Changes reach them only through pull requests.
- **Nothing goes to `main` unless it is already in `dev`.** The only pull requests into `main` are release PRs from `dev`.
- If a change is urgent, it still goes through `dev`; do not bypass the flow.

### Branch rules

1. Start every change from an up-to-date `dev`:
   ```bash
   git fetch origin
   git switch dev && git pull --ff-only
   git switch -c feat/<slug>   # or fix/<slug>
   ```
2. Use short kebab-case slugs that describe the change, e.g. `feat/workspace-invites`, `fix/pdf-stale-banner`.
3. One branch = one feature or one fix. Do not mix unrelated changes.
4. Never commit directly to `main` or `dev`, and never force-push either branch.

## Feature requests

- Any new feature starts on `feat/<slug>` branched from `dev`.
- Add or update tests for the new behavior in the same branch.
- Open a PR into `dev`, get it reviewed, then squash/merge.
- After the feature is verified in `dev`, `dev` is promoted to `main` through a release PR.

## Bug fixes

- Any bug fix starts on `fix/<slug>` branched from `dev`.
- Add a regression test that fails before the fix and passes after it.
- Open a PR into `dev`, get it reviewed, then merge.
- Fixes reach production only through the next `dev` → `main` release PR.

## Pull requests

Every PR must:

- Target `dev` (feature/fix) or `main` (release PR from `dev` only).
- Have a clear title and a short description of what changed and why.
- Reference the related issue when one exists.
- Keep the diff scoped to the branch's single purpose.
- Pass all required checks (below) before merge.
- Include tests for new features and regression tests for fixes.
- Not regress existing behavior. If a behavior intentionally changes, say so in the PR description and update the affected tests.

Merge strategy: squash-merge feature/fix PRs into `dev`. Release PRs merge `dev` into `main` without rewriting history.

## Quality gates

Run these before opening or updating a PR. All of them must pass:

```bash
./node_modules/.bin/tsc --noEmit
bun run test
./node_modules/.bin/eslint .
bun run build
```

Database integration tests (when the change touches workspaces, sharing, or access control) require the local Postgres from `docker/docker-compose.yml`:

```bash
docker compose -f docker/docker-compose.yml up -d
bun run test:integration
```

### Testing expectations

- **Existing tests must keep passing.** A red existing test is a regression, not a flake to ignore.
- **New features need new tests** covering the happy path and the important failure/authorization paths.
- **Bug fixes need a regression test** that reproduces the bug before the fix.
- Prefer extending the closest existing test file and following its mocking style (`vitest`).
- Never delete or weaken a test to make a change pass; fix the code or explicitly justify the test change in the PR.

## Commits

- Small, focused commits with imperative messages, e.g. `add workspace invite expiry`.
- Do not commit secrets, `.env` files, generated Prisma clients, or build output.
- Keep the working tree free of unrelated edits before opening a PR.

## Definition of done

A change is done when:

1. It is on a `feat/` or `fix/` branch cut from `dev`.
2. It has tests and the full quality gate above passes.
3. It is merged into `dev` through a reviewed PR.
4. It reaches `main` only via a `dev` → `main` release PR.
