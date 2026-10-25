# Workspaces, teams, and access: what was built and how to check it

Companion to [workspaces-teams-access-plan.md](workspaces-teams-access-plan.md),
[workspaces-teams-access-baseline.md](workspaces-teams-access-baseline.md) and
[workspaces-teams-overnight-agent-prompt.md](workspaces-teams-overnight-agent-prompt.md).
This is the handoff: what landed, the decisions that are not visible in a diff, and the exact
commands that reproduce every claim.

## Commits on `feat/workspaces-teams-access` (base `dev` at `30ac83b`)

| Stage | Commit | Content |
| --- | --- | --- |
| 1 | `f22eed1` | Baseline document and the entry-point capability inventory |
| 2 | `da167a9` | `Workspace`, `Team`, `TeamMember`, `Invitation`, `WorkspaceGrant`, `DocumentGrant`, `AdminAuditEvent`, required `Document.workspaceId`, backfill and constraints, plus the migration proof script |
| 3 | `4765d7c` | `src/lib/access-policy.ts` (pure matrix) and `src/lib/access.ts` (facts plus enforcement) with the matrix tests |
| 4 | `93dcde3` | Workspace, document, share, invitation, team and admin endpoints |
| 5 | `0e7192f` | Every document entry point routed through the capability service, including the legacy slug routes, assets, jobs and the document-scoped PDF read |
| 6 | `9027343` | Workspace-aware library, share and move dialogs, invitation acceptance, viewer editor state, admin console |
| 7 | `71a7b99` | PostgreSQL integration suite and its scratch-database runner |
| 8 | `9de36b0` | Single session resolver, multi-account UI surface smoke, gated-chrome component tests |

90 files changed, about 7.6k added lines, 307 removed.

## How to verify everything

| Gate | Command | Expected |
| --- | --- | --- |
| Schema | `npx prisma validate` | `The schema ... is valid` |
| Migrations against a fresh database | `bash scripts/migration-proof.sh` then `bash scripts/workspace-access-migration-proof.sh` | both exit 0 |
| Types | `npx tsc --noEmit` | no output, exit 0 |
| Lint | `npx eslint .` | 0 errors (8 pre-existing warnings) |
| Unit and component tests | `npx vitest run` | `4 failed / 326 passed / 24 skipped (354)` — the four failures are the pre-existing `useSession`-without-a-provider cases in `src/__tests__/workspace-ui.test.tsx`, present on `dev` before this branch |
| Database integration tests | `bash scripts/workspace-integration-tests.sh` | `16 passed` |
| Multi-account HTTP and page smoke | start `npm run dev`, then `node scripts/ui-surface-smoke.mjs` | `51/51 checks passed` |
| Production build | `npm run build` | exit 0 |

`scripts/workspace-integration-tests.sh` derives a throwaway database from `DATABASE_URL`
(override with `WORKSPACE_IT_DB`), refuses a name that looks like an application database,
recreates it from the migrations and points `DATABASE_URL_TEST` at it. Without that variable
`src/__tests__/workspace-access.integration.test.ts` skips itself, which is what keeps the
default suite database-free.

`scripts/ui-surface-smoke.mjs` needs a running dev server with `DEV_AUTH_BYPASS=1`, plus
`DATABASE_URL` for the admin half. It creates its own accounts on the `.test` domain, its own
workspace, document, team and shares, and deletes the document again unless `--keep` is passed.

## The permission model in one page

`src/lib/access-policy.ts` holds the decision as a pure function over facts; `src/lib/access.ts`
loads the facts and turns a denial into a 404. Nothing else decides.

| Actor | read | edit | share | move | delete |
| --- | --- | --- | --- | --- | --- |
| author with a live door into the workspace | yes | yes | yes | yes | yes |
| accepted document recipient | yes | no | no | no | no |
| accepted personal-workspace recipient | yes, for the whole collection | no | no | no | no |
| active team member | yes | no | no | no | no |
| team admin looking at somebody else's document | yes | no | no | no | no |
| app admin through the inspection endpoint | yes | no | no | no | no |
| pending invitee, unrelated account, revoked member | no | no | no | no | no |

Three rules do most of the work:

* A share grants nothing until the named, signed-in address accepts it. A token on its own is
  not a credential, and a link sent to somebody else reports only `wrong-email`.
* Every document write is author-only. Membership, a share and an admin flag all open the read
  side and never the write side, so a team admin reading a member's document gets the same 404
  as somebody who does not exist.
* An author needs a live door into the workspace holding the document. Remove them from the
  team and their team documents stop resolving for them while the attribution stays.

## Decisions worth reading before the code

* **Identity of a document.** `/document/id/[id]` plus `GET /api/documents/[id]` is the new
  canonical surface; `canonicalPath` in that response names the author-scoped legacy URL so old
  links keep landing. Legacy `/document/[slug]` routes survive, but the slug lookup in
  `src/lib/access.ts` is filtered by `readableWhere(userId)`: a slug is never resolved across an
  access boundary, so two workspaces holding the same title cannot leak into each other. If a
  caller can read two readable documents that share a slug, the legacy route picks one of them —
  the id route is exact, and that is what new links use.
* **A workspace collection disappears with its owner.** `workspaces_exactly_one_owner` forbids a
  row with neither `ownerUserId` nor `teamId`, so the original `ON DELETE SET NULL` foreign keys
  would have made the deletion of any account that owns a workspace fail partway through. The
  follow-up migration `20261025200000_workspace_owner_lifetime` cascades instead. Documents are
  untouched by that change: they cascade from their author, and `documents_workspaceId_fkey`
  stays `RESTRICT`, so a workspace that still holds rows cannot be deleted at all — the plan's
  "workspace deletion must not silently delete documents".
* **A viewer is built from server flags only.** `GET /api/document/[slug]` returns
  `document.access` and `document.author{name,email}`; the editor disables autosave, title
  edits, file writes, uploads, AI and chat, compile and delete from those flags and loads the
  preview through `/api/documents/[id]/pdf`. Hiding a button is a courtesy; the server checks
  remain the control, and the integration suite proves the write surfaces return 404.
* **Job ids are not capability tokens.** `/api/job/[jobId]` and `/api/pdf/[jobId]` stay tied to
  the account that submitted them; a shared reader goes through the document-scoped route, which
  re-decides on every request and answers `private, no-store`. Revoking a share cuts the cached
  PDF on the next fetch without touching the job.
* **One session resolver.** `src/lib/session.ts` answers who is asking for route handlers and
  server-rendered pages alike: NextAuth in production, the signed development cookie re-read from
  the database in development. The admin page used to call `auth()` directly, which meant it
  redirected for everybody on a machine without an OAuth provider.
* **Compiles and snapshots stay author-only.** A viewer's preview comes from a build the author
  (or a prior author-initiated snapshot) produced; v1 never queues work on a reader's behalf.

## Verification against the plan's acceptance list

| Requirement | Where it is proved |
| --- | --- |
| Every document sits in exactly one workspace; backfill is idempotent | integration test "puts every document in exactly one workspace and stays repeatable", `scripts/migration-proof.sh` |
| Default personal workspace under concurrent sign-in | integration test "creates one default personal workspace even under concurrent sign-ins" (the SQL partial unique index is the arbiter) |
| Duplicate title in one workspace is a conflict, in another it is fine | integration test "refuses a duplicate title in one workspace..." |
| A move states who gains access before it happens | `describeMove` + UI smoke "the move preview says the team will gain view access" |
| A team member reads the team workspace, never rewrites a colleague | integration test "lets a team admin read the team workspace..." plus the reader write surfaces |
| Last active admin cannot be removed | integration test "keeps the last active admin of a team" (guard runs inside the row-locked transaction) |
| Invitation grants nothing until accepted; revocation bites on the next request | integration test "grants nothing until the named person accepts..." and UI smoke "the reader loses the document on the next request" |
| An unrelated account gets 404 on every surface | integration test "refuses an unrelated account on every read and write surface" (11 surfaces) and UI smoke (7 reader write surfaces) |
| A workspace share covers documents created later | integration test "treats a workspace share as the collection it is..." |
| App admin is read-only, audited, and outside the ordinary document surface | integration test "keeps an app administrator read-only..." and UI smoke "admin rights are not document rights..." |
| The library shows author, workspace and the caller's capability | integration test "answers the library with the capability flags..." and UI smoke "the library names the author..." |
| Viewers get no write affordance at all | `src/__tests__/workspace-access-ui.test.tsx` "renders a reader as a reader..." |

## What was not, and could not, be checked here

* **No browser was available on this machine.** There is no Chromium or CDP endpoint, so the
  plan's click-through stage was replaced by two substitutes: `scripts/ui-surface-smoke.mjs`
  (real HTTP against the real dev server, five accounts, 51 assertions, including the
  server-rendered `/admin` and `/document` responses) and static-render component tests for the
  gated chrome. What still needs a human with a browser: visual layout of the new dialogs, focus
  and keyboard behaviour, the optimistic states inside the editor while typing, and the
  access-lost state in an editor that is already open when a share is revoked.
* **Redis and the compile worker were not running**, so no successful compile is exercised
  anywhere: the rate limiter blocks on Redis indefinitely. Everything asserted about compiles is
  who may dispatch one and who may read the artifact; the job and PDF paths are covered with an
  instrumented producer double.
* **Email delivery is a development link here.** Without `INVITE_EMAIL_WEBHOOK_URL` the
  invitation reports `delivery.channel = "development-link"` and returns the accept path, which
  is what the smoke uses. The webhook and webhook-failure paths are unit-tested only.
* **Four tests fail for a pre-existing reason.** `src/__tests__/workspace-ui.test.tsx` renders
  `WorkspacePanel` where a `useSession` call needs a `SessionProvider`; it fails identically on
  `dev` and was left alone rather than silently rewriting a suite this branch did not author.
* Packages were installed with `npm install --ignore-scripts` because `bun` is unavailable, so
  `package-lock.json` can show unrelated churn; it is deliberately not part of any commit.

## Suggested review order

1. `src/lib/access-policy.ts` — the whole permission matrix in one pure file.
2. `src/__tests__/access-policy.test.ts` — the matrix as a table of cases.
3. `src/lib/access.ts` — how facts are loaded and how a denial becomes a 404.
4. `src/lib/workspaces.ts`, `src/lib/teams.ts`, `src/lib/invitations.ts`, `src/lib/admin.ts` —
   the services, each of which calls the access layer before it touches a row.
5. `src/app/api/**` — the routes; each one is thin and ends in a capability call.
6. `src/__tests__/workspace-access.integration.test.ts` and `scripts/ui-surface-smoke.mjs` — the
   behaviour from the outside, first through SQL and then through HTTP.
