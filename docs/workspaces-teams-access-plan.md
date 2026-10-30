# Workspaces, teams, sharing, and admin plan

Status: proposed implementation plan, 25 October 2026.

## Goal and scope

Give each user workspaces that hold multiple documents. Add teams with invitations and a default team workspace. Members can read documents in that team workspace. An author can share a whole personal workspace or one document with another user. The author keeps edit access; recipients get view access. Add an admin dashboard to inspect teams, their members, documents and authors, create teams, and remove members.

This release does not include simultaneous editing, presence, cursors, pair editing sessions, comments, or an editable permission for recipients. Keep authorization rules centralized so an edit grant can be added later without rewriting every route.

## Current code and terms

- `Document` belongs to one `User` through `userId`. Its title and slug are unique per user in `prisma/schema.prisma`. There is no team, document collection, invitation, or admin model.
- `WorkspaceFile` already means a file **inside one document**. `workspace-files.ts` and `/api/document/[slug]` call that file bundle a "workspace." The new `Workspace` model means a **collection of documents**. Keep `WorkspaceFile` and its API behavior, but label the concepts clearly in code and UI.
- Google sign-in creates users in `src/lib/auth.ts`; `withAuth` supplies the database user ID. The dashboard at `/document` lists only documents whose `userId` matches the session. The editor URL uses `/document/[slug]`.
- Document, asset, file, chat, AI, compile, job, and PDF routes use author or submitting-user checks. Shared reads require deliberate changes to those paths. Client controls alone cannot enforce view-only access.
- The file editor has revisions for conflict detection. Those revisions protect saved files but do not provide concurrent editing or a collaboration session.

## Product rules for the first release

### Ownership and access

1. Every document has one immutable author (`Document.userId`) and belongs to exactly one collection workspace (`Document.workspaceId`). A document cannot be in two workspaces. Its author may move it between their personal workspaces and team workspaces where they are a member, subject to the move rules below.
2. Every existing and new user has a default personal workspace. A user may create additional personal workspaces, rename them, and place multiple documents in each. Personal workspaces are private until shared. Owners may delete an additional personal workspace only when it is empty; the default personal workspace cannot be deleted.
3. A team has one default team workspace when created. The schema can support more later, but creating extra team workspaces is outside this release. All active team members can view every document in the default team workspace, including documents authored by another member. A member may create documents there and edit only their own documents.
4. The author can share a personal workspace or a single document by email. A workspace share covers its current and future documents while active. A document share covers only that document. The recipient can read; the author can read and edit while they remain a member of the containing workspace. Recipients cannot change the title, content, files, main file, assets, favorite state, sharing, workspace assignment, or document lifecycle. A team member likewise cannot edit another member's document.
5. The user must accept an invitation before a team membership or personal share becomes active. Invitations to an email without an account remain pending until that email signs in and accepts. Email comparison is normalized and verified against the signed-in account. A copied invitation token alone does not authorize access.
6. An author may revoke a share. A team admin may remove a member. Revocation takes effect on the next server request, including file and asset reads. A removed author retains attribution to their team documents but loses access through the team. A team admin should move or archive those documents before removal if continued author maintenance is needed. Open editor views must stop future requests and show an access-lost state. Content already downloaded to a browser cannot be recalled.
7. The author can move a document only between workspaces they can author in. A move to a team workspace grants its members view access; moving it out removes that inherited access. A direct document share remains attached to the document after a move. Show this change before confirming the move.
8. Team admins manage the team and can view its default workspace, but do not gain edit access to documents authored by other members. An app admin can inspect and manage teams in the admin dashboard. App admin inspection is a separate, audited permission and must not silently grant editing.

### Permission matrix

| Actor | Read document and files | Create in workspace | Edit own document | Edit another author's document | Share or move document | Manage team |
| --- | --- | --- | --- | --- | --- | --- |
| Personal workspace owner | Yes | Yes | Yes | No | Yes, for own documents | No |
| Accepted personal workspace or document recipient | Yes, for the shared scope | No | No | No | No | No |
| Active team member | Yes, for the default team workspace | Yes | Yes | No | Own documents only | No |
| Team admin | Yes, for the default team workspace | Yes | Yes | No | Own documents only | Invite and remove members |
| App admin | Yes, through audited admin inspection | No by default | No by default | No | No by default | Create teams, inspect and manage all teams |
| Uninvited user or pending invitee | No | No | No | No | No | No |

`canReadDocument` is true for the author while they have access to the containing workspace, an accepted direct document grant, an accepted personal workspace grant, an active member of the document's team, or an app admin using an admin endpoint. `canEditDocument` is true only for the author while they still have the right to author in that workspace. A general editor route must not treat app admin inspection as author access. Deny unknown or revoked grants by default and return a nonrevealing 404 for inaccessible document IDs and URLs.

### Admin boundaries

Use an explicit app-wide admin flag or role on `User`, provisioned through a controlled seed or deployment operation. Do not infer it from an email domain, a client claim, or a user-supplied request. Team admins are scoped to their own team. The admin dashboard must show team name, member count, workspace, documents with title/format/author/updated time, invitations, and member roles. It must create a team, invite a member, remove a member, and change a team's admin where needed. Protect against removing the last team admin. Display who performed member removal. Initial admin document inspection is read-only.

## Data model and migration

Add these Prisma models and constraints, with names adjusted to match repository conventions:

| Model or field | Purpose and required constraint |
| --- | --- |
| `Workspace` | ID, name, kind (`PERSONAL` or `TEAM`), `ownerUserId?`, `teamId?`, `isDefault`, timestamps. Exactly one owner type. Unique default personal workspace per owner and unique default team workspace per team, enforced in SQL where Prisma cannot express a partial constraint. |
| `Document.workspaceId` | Required foreign key after backfill, indexed. Keep `userId` as the author. Document deletion still cascades to its files and assets. Workspace deletion must not silently delete documents. |
| `Team` | ID, name, creator, timestamps, optional archived status. A team has one default workspace. |
| `TeamMember` | Unique `(teamId, userId)`, role (`ADMIN`, `MEMBER`), active status or deletion timestamp, joined time. Membership changes are transactional. |
| `Invitation` | Target normalized email, inviter, target team/workspace/document, status, expiry, hashed one-use token, accepted user/time. Exactly one target type. Unique active invitation per target and email. |
| `WorkspaceGrant` / `DocumentGrant` | Unique target and recipient user, `VIEW` permission, accepted/revoked timestamps. Grants are direct and separate from team inheritance. An enum can reserve `EDIT` for a later migration, but no v1 route may issue or honor it. |
| `AdminAuditEvent` | Actor, action, target IDs, timestamp, small metadata for team creation, invitations, removals, role changes, and admin document inspection. Do not store document content or invitation tokens. |

Implementation details:

1. Add nullable `workspaceId` and new tables first. Create one default personal workspace per existing user, then assign each existing document to its author's default workspace. Backfill in batches or a resumable script; verify counts and author/workspace consistency. Finally make `workspaceId` required. Existing documents remain private and retain IDs, slugs, files, assets, chats, and authors.
2. Create the default personal workspace inside the new-user sign-in transaction or an idempotent `ensureDefaultPersonalWorkspace` service. Handle concurrent first requests with a database uniqueness constraint and an upsert. Keep an idempotent repair path for preexisting users.
3. Create a team, its first admin membership, and its default workspace in one transaction. Accept invitations and remove members in transactions; prevent a last-admin removal under concurrent requests.
4. Decide slug identity before changing URLs. Recommended: move document routes to ID-based URLs (`/document/id/[id]`) and redirect old author `/document/[slug]` links through their existing owner-specific lookup. Do not resolve a shared document by an unscoped slug. If existing URLs must remain canonical, add workspace-qualified routes and disambiguate by workspace ID.
5. Revisit `@@unique([userId, title])` and `@@unique([userId, slug])`. A collection workspace should allow the same title in different workspaces. Recommended replacement is uniqueness on `(workspaceId, slug)` and, if the UI needs it, `(workspaceId, title)` with collision handling during moves. Preserve old slugs through the transition and return a clear conflict on a duplicate target title.
6. Deleting a team or workspace is deferred. Admins can remove members and archive teams; existing content remains attributable to its author. Define a separate content-transfer and retention policy before destructive deletion.

## Application and API work

### Shared authorization service

Implement `getWorkspaceCapabilities(userId, workspaceId)` and `getDocumentCapabilities(userId, documentId)` in one server-only module. Return `canRead`, `canCreate`, `canEdit`, `canShare`, `canManageTeam`, and the reason/source of access where useful to the UI. Use database membership and accepted grants on every protected request. Give service functions explicit read or edit intent; never reuse a read check for a write path. Run sensitive mutations in transactions that recheck permission immediately before the write.

Inventory and replace owner-only lookups in:

- `src/app/api/document/route.ts` and every route under `src/app/api/document/[slug]/`, including legacy content updates, file reads/writes/moves, main-file changes, uploads, and both asset implementations.
- `src/lib/workspace-files.ts` and `src/lib/workspace-snapshot.ts`. Keep file-path validation and revision conflict checks. Only the author may invoke migration or write helpers that mutate rows; a shared read should not unexpectedly migrate a legacy document.
- `src/app/api/chat/route.ts` and both AI routes. In v1, keep AI generation and chat author-only because they consume quotas and may expose document content to a provider. The viewer UI should hide those controls, and direct API calls must fail.
- Compile submission, job status/cancellation, and PDF retrieval. In v1, only an author can submit or cancel a compile. A viewer may read a completed PDF only through a document-scoped endpoint that checks *current* document read access. Existing `/api/job/[jobId]` and `/api/pdf/[jobId]` remain tied to the submitting user, so an old job ID cannot bypass revocation. If a viewer needs a PDF and no author compile exists, show "No preview available".

Prefer document IDs in new APIs. Proposed endpoints:

| Route | Access | Behavior |
| --- | --- | --- |
| `GET/POST /api/workspaces` | Signed-in user | List accessible personal/team workspaces with document title metadata for the sidebar; create a personal workspace. |
| `GET/PATCH/DELETE /api/workspaces/[id]` | Member/owner as appropriate | Metadata and rename; owners may delete empty, non-default personal workspaces. |
| `GET/POST /api/workspaces/[id]/documents` | Workspace reader / creator | List documents with author and capability flags; create a document in the selected workspace. |
| `POST /api/documents/[id]/move` | Author | Move to an allowed workspace, recheck sharing implications, reject collisions. |
| `POST/GET/DELETE /api/workspaces/[id]/shares` | Personal workspace owner | Invite, list, revoke view grants. |
| `POST/GET/DELETE /api/documents/[id]/shares` | Document author | Invite, list, revoke view grants. |
| `GET/POST /api/invitations/[token]` | Matching signed-in email | Preview and accept an unexpired invitation. |
| `GET/POST /api/teams` | App admin for create; member for list | List joined teams or create team with default workspace. |
| `GET/POST/DELETE /api/teams/[id]/members` | Team admin or app admin | List, invite, remove. Use an explicit member ID for removal. |
| `GET /api/admin/teams/[id]/documents` | App admin | Read-only document list and author details, paginated and audited. |

Validate all payloads with Zod. Normalize email once, rate limit invitations, cap pending invitations, and avoid account enumeration in invite responses. Store token hashes, set expiry, support resend/revoke, and make acceptance idempotent. Provide a delivery method for invite links; use the existing email infrastructure if present, otherwise include a mail provider setup and a development link display restricted to the inviter. Never log a live token in production.

### User interface

1. Turn `/document` into a workspace-aware library. Provide a workspace switcher with personal workspaces, joined team workspaces, and documents shared directly with the user. Show author, workspace, format, and the user's `View` or `Edit` capability. Keep search and filters scoped visibly to the selected workspace.
2. Add create/rename personal workspace, create document in the selected workspace, move an authored document, and share controls on personal workspaces and authored documents. Show pending invitations and revoke actions. Make a team workspace visibly read-shared to all members.
3. Add an invitation acceptance page with the target name, inviter, scope, and `View` permission. Sign-in must preserve a safe return URL. Handle expired, revoked, duplicate, wrong-email, and already-accepted states.
4. In the editor, show author and access level. For viewers, disable autosave, title changes, file changes, uploads, AI/chat controls, compile, and delete. Keep source, file tree, assets, and existing completed PDF readable. Server checks remain authoritative.
5. Add `/admin` with team creation, member management, document and author listings, and audit history. Show its navigation only to app admins and reject direct route/API access for others. Add `/teams/[id]` for joined team members to open team documents and for team admins to invite or remove members. Link it from each team workspace. Confirm member removal and show its effect on team workspace access.

## Implementation sequence and acceptance gates

1. **Schema and migration.** Add models, constraints, backfill, and a verifier. Gate: every document has one workspace; all old documents remain accessible to their author; rerunning the backfill changes nothing.
2. **Policy layer.** Add capability queries and unit tests for owner, recipient, team member, team admin, app admin, pending invitee, removed member, and unknown user. Gate: permissions follow the matrix above.
3. **Read routes and workspace library.** Add workspace lists and document reads by ID; update file/asset reads and library UI. Gate: a team member and direct recipient can read only the intended scope.
4. **Write protection.** Update every mutation route and editor capability state. Gate: recipient requests cannot write through legacy or new APIs, including hidden endpoints.
5. **Invitations and teams.** Add creation, acceptance, expiry, revocation, team membership, default workspace creation, and member removal. Gate: a pending invite grants nothing and removal cuts access immediately.
6. **Admin dashboard.** Add controlled app-admin provisioning, lists, create and remove flows, pagination, and audit events. Gate: normal users cannot use admin pages or APIs; last team admin remains protected.
7. **Cutover.** Run migration on a staging database copy, deploy additive schema before app code, verify backfill, switch application reads, and only then enforce the required foreign key. Keep a rollback path that leaves old document ownership and URL behavior intact until the new read path is verified.

## Test plan

### Automated tests

- Unit tests for permission precedence, author-only editing, team inheritance, workspace and document shares, revocation, invite expiry, wrong-email acceptance, duplicate invitations, and last-admin protection.
- Database integration tests for default workspace creation under concurrent sign-ins, team/default-workspace transaction, idempotent backfill, document move collision, share creation/revocation, and foreign key behavior. Use PostgreSQL because the production schema and partial constraints require it.
- API tests with at least author A, viewer B, unrelated C, team admin D, and app admin E. Exercise list, document/file/asset read, save, rename, delete, upload, main-file change, AI/chat, compile, job, and PDF routes. Verify B can read only shared content and cannot write; C gets 404; revocation applies to subsequent requests. Test legacy endpoints as well as new ones.
- Browser flows: create two personal workspaces, create multiple documents, invite a user to one document and one workspace, accept as the matching user, open as viewer, try write actions, create a team, see member-authored documents in its default workspace, remove a member, and verify lost access. Check keyboard use and narrow viewport for the switcher and admin actions.
- Migration proof: before/after counts for users, documents, files, assets, chats, and author ownership; sample old URLs; rollback of application code against the additive schema. Record exact failures rather than treating unrun checks as passed.

Run `bunx prisma validate`, `bunx prisma migrate status`, `bunx vitest run` (targeted and full suite), `bunx tsc --noEmit`, `bunx eslint .`, and `bun run build`. Run browser tests against a local stack with PostgreSQL and Redis. Use deterministic invite delivery and no real email or AI provider in automated tests.

### Release acceptance criteria

- Existing accounts open all previous documents from their new default personal workspace without content, file, asset, chat, or URL loss.
- One user owns at least two personal workspaces, with at least two documents in one workspace, and the library shows only the selected scope.
- An accepted document share exposes only that document; an accepted personal workspace share exposes its current and later documents. Recipients can view but all write APIs deny them.
- Every active team member sees every document in the team's default workspace, with the correct author. Only each document's author can edit it. Removed members lose access on the next request.
- The app admin can create teams, list team documents and authors, invite and remove members, and inspect the audit trail. A non-admin cannot reach those functions.
- A guessed ID, old slug, job ID, asset path, or invitation token does not bypass access checks. No simultaneous editing behavior is claimed or exposed.

## Deliverables

1. Prisma migration and idempotent backfill/verification script, with a recorded staging migration report.
2. Central authorization and invitation services, documented permission matrix, and updated document, file, asset, AI, compile, job, and PDF routes.
3. Workspace-aware library and viewer/editor states; sharing, invitation, team, and admin screens.
4. Automated unit, database, API, and browser tests with recorded command results.
5. Deployment notes for app-admin provisioning, invite email configuration, migration order, rollback, and known limits.

## Decisions to confirm before implementation

The plan uses these defaults so work can be estimated. Confirm them before building the affected UI or migration:

1. Should team admins be allowed to invite/remove members, or should only app admins do that? This plan allows both, scoped to their own teams for team admins.
2. Should a shared personal workspace expose future documents automatically? This plan says yes. The sharing UI must state that plainly.
3. Is an email delivery provider available? The repository currently has Google sign-in but no invite email integration. Invite delivery needs a provider choice and sender address.
4. Should team members create documents in the team workspace? This plan says yes, with author-only editing.
5. Should app admins read document content, or only document metadata? This plan limits the dashboard to metadata and requires an audited, explicit inspection action for content.
