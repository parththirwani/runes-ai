# Workspaces, teams, and access: starting state and entry-point inventory

Companion to [workspaces-teams-access-plan.md](workspaces-teams-access-plan.md) and
[workspaces-teams-overnight-agent-prompt.md](workspaces-teams-overnight-agent-prompt.md).
This file records the starting state before stage 1 so later results can be compared with evidence.

## Starting Git state

| Item | Value |
| --- | --- |
| Branch at start | `dev` |
| HEAD at start | `30ac83b18e8a1e65992d7a364bfdeeff34524c26` (`docs`) |
| Working tree | clean (`git status --short` empty) |
| Working branch for this work | `feat/workspaces-teams-access` |
| Target branch for the pull request | `dev` |

## Toolchain used for verification

| Tool | Version |
| --- | --- |
| Node.js | v24.21.0 |
| vitest | 3.1.1 |
| Prisma CLI / client | 7.2.0 |
| PostgreSQL (local, disposable, used for migration and integration checks) | 14.24 |
| Packages installed with | `npm install --ignore-scripts` (bun is not available in this environment) |

`bunx` invocations in the plan are run here as `npx` equivalents because the sandbox has no bun
binary; the recorded commands are the exact commands used.

## Baseline before any code change (recorded on `dev` at `30ac83b`)

| Command | Exit code | Result |
| --- | --- | --- |
| `npx prisma validate` | 0 | schema valid |
| `npx prisma generate` | 0 | client generated to `src/generated/prisma` |
| `npx vitest run` | 1 | 32 files passed, 1 file failed; **4 failed / 305 passed / 8 skipped** |
| `npx tsc --noEmit` | 0 | no type errors |
| `npx eslint .` | 0 | 0 errors, 8 warnings (all pre-existing `no-unused-vars`) |
| `npm run build` | 0 | production build succeeded |

Pre-existing failures at baseline (all in `src/__tests__/workspace-ui.test.tsx`, all caused by
`useSession()` being called inside `WorkspacePanel` without a `SessionProvider` in the test):

- `WorkspacePanel > renders a nested folder tree with every workspace path`
- `WorkspacePanel > marks the main file, the active file, and unsaved or stale files`
- `WorkspacePanel > surfaces workspace errors with a dismiss action`
- `WorkspacePanel > keeps the panel mounted but off-canvas when closed`

These four failures are the baseline for comparison. A later run that shows a different failure
set means a regression was introduced by this work.

## Entry-point inventory

Every server-side read or write of document content, files, assets, chats, AI, jobs, or PDFs, and
the capability it must require after this work. `read` = `getDocumentCapabilities().canRead`,
`edit` = `canEdit` (author only in v1), `create` = `getWorkspaceCapabilities().canCreate`,
`admin` = app-admin flag plus an audit event.

| Entry point | Operation | Required capability today | Required capability after |
| --- | --- | --- | --- |
| `GET /api/document` (`src/app/api/document/route.ts`) | list own documents | `userId = session` | list across every workspace/`documentId` grant the user can read, with capability flags |
| `POST /api/document` | create document | `userId = session` | `canCreate` on the target workspace, author stays `userId` |
| `GET /api/document/[slug]` | workspace tree + main source | owner-only | `read` (viewer-capable), no migration write for a non-author |
| `POST /api/document/[slug]` | submit compile | owner-only | `edit` (author only) |
| `PUT/PATCH /api/document/[slug]` | save files/title, favorite | owner-only | `edit`; favorite/rename/move/delete are `edit` |
| `DELETE /api/document/[slug]` | delete document | owner-only | `edit` |
| `GET/PUT/DELETE /api/document/[slug]/file` | read/write/delete one `WorkspaceFile` | owner-only | `read` / `edit` |
| `POST /api/document/[slug]/move` | rename or move a file | owner-only | `edit` |
| `POST /api/document/[slug]/main` | change main file | owner-only | `edit` |
| `POST /api/document/[slug]/upload` | upload bytes | owner-only | `edit` |
| `GET /api/document/[slug]/asset` | serve `WorkspaceFile` bytes | owner-only | `read` |
| `GET/POST /api/document/[slug]/assets` | list/upload `DocumentAsset` | owner-only | `read` / `edit` |
| `GET/DELETE /api/document/[slug]/assets/[...path]` | serve/delete `DocumentAsset` | owner-only | `read` / `edit` |
| `GET /api/document/[slug]/asset` and asset routes used by Markdown previews | image bytes in a shared document | owner-only | `read`, so a viewer can render source images |
| `POST /api/chat` | send document source to the AI provider | owner-only | `edit` (author only in v1) |
| `POST /api/ai/complete`, `POST /api/ai/paraphrase` | AI on document source | owner-only | `edit` (author only in v1) |
| `GET/DELETE /api/job/[jobId]` | status / cancel | `job.userId = session` | unchanged: tied to the submitting user |
| `GET /api/pdf/[jobId]` | download a job PDF | `job.userId = session` | unchanged: an old job id must not bypass revocation |
| `src/lib/workspace-files.ts` (`getOwnedDocument`, `readWorkspaceTree`, `readWorkspaceFile`, `readWorkspaceAsset`) | shared helpers behind the routes above | owner-only | split into read (capability) and write (author) helpers; writes keep re-checking inside the mutation |
| `src/lib/workspace-snapshot.ts` (`createCompileSnapshot`) | snapshot read for compile | owner-only | `edit` path only |
| `/document` dashboard | lists `userId = session` | owner-only | workspace-scoped library with author and `View`/`Edit` |
| `/document/[slug]` editor | full editor for the owner | owner-only | same page renders a viewer state when `canEdit` is false |

Naming note kept from the plan: `WorkspaceFile`/`workspace_files` stay the name for **files inside a
document**. The new `Workspace` model is a **collection of documents**. The new code uses the words
`collection`/`workspace` for the document set and `document files` for the file bundle.
