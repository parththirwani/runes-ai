# Overnight implementation prompt: workspaces, teams, and access

Give the coding agent this entire file together with `docs/workspaces-teams-access-plan.md`. The checklist is the completion gate. The agent should update a copy of it with evidence as it works.

## Prompt

> Implement the workspaces, teams, sharing, and admin features described in `docs/workspaces-teams-access-plan.md` in this repository. Read that plan, the repository instructions, the Prisma schema, the current document and editor flows, and the existing tests before changing code. Treat the plan's permission matrix and release acceptance criteria as requirements. This is an implementation task: continue through code, migration, tests, browser verification, and a final report.
>
> Use these v1 product decisions unless the user has given a newer instruction: users can own multiple personal workspaces; every team has one default team workspace; active team members can create documents there and view all team documents; only each document's author can edit it; an accepted personal workspace or document recipient has view access; a personal workspace share includes future documents; team admins can invite and remove members in their team; app admins can create and inspect teams; the admin document list shows metadata, while any content inspection is an explicit audited action. Do not implement simultaneous editing or pair sessions. If a detail is unclear, choose the smallest design consistent with these rules and record the choice in the final report.
>
> Work in this order, keeping the app usable after each stage:
>
> 1. Record the starting Git state and the current test/build baseline. Identify every document read and write entry point, including old routes, `WorkspaceFile` helpers, Markdown and LaTeX assets, AI/chat, compile jobs, PDFs, and dashboard actions. Map each to a required capability. Keep the collection `Workspace` distinct from the existing files inside a document.
> 2. Add the database models, constraints, additive migration, idempotent backfill, and verification script. Preserve existing document IDs, authors, content, files, assets, chats, and old links. Use transactions for team/default-workspace creation, invitation acceptance, membership removal, and document moves. Prove the backfill works twice and that the second run changes no data.
> 3. Implement one server-only capability service for workspace and document access. Cover the author, direct document recipient, personal workspace recipient, active team member, team admin, app admin, pending invitee, removed member, and unrelated user. Recheck authorization at mutation time. Add tests before wiring new UI.
> 4. Add workspace and document APIs using stable IDs for new flows. Update all legacy routes and helpers so shared users can read only their scope and cannot write. Keep AI/chat and compile submission author-only. Keep job cancellation tied to the submitting user. Expose a completed PDF to a viewer only through a document-scoped read that checks current access, so revocation works. Preserve file revision conflicts and path validation.
> 5. Add invitations and teams. Match an invitation to the signed-in, verified email; hash one-use tokens; expire and revoke them; avoid account enumeration. Support team member removal and protect the last team admin. If no production email provider is configured, implement a clearly restricted local delivery path for development and report production delivery as incomplete. Do not expose raw tokens in logs.
> 6. Build the workspace switcher and document library, create/rename/move/share flows, invitation acceptance, viewer editor state, and admin dashboard. Show the document author and the user's access level. Disable viewer mutation controls for clarity, then verify direct API writes still fail. Make admin lists paginated and scoped to app admins. Record admin actions in the audit log.
> 7. Run targeted tests during development. After the last code change, run the full verification below. Use a real local PostgreSQL database for migration and integration checks and a local Redis/worker stack for compile/PDF checks. Use deterministic accounts and invitation delivery for automated tests. Do not send real invitations or call a real AI provider in tests.
>
> For browser and API checks, create five distinct accounts: author A, invited viewer B, unrelated user C, team admin D, and app admin E. Verify a direct document share, a personal workspace share, and a team default workspace. Test access before acceptance, after acceptance, and after revocation/removal. Attempt writes through the UI and each relevant HTTP route as B and C. Verify team members can view documents by different authors while only the respective authors can save changes. Verify a viewer can read a completed PDF and loses that access after revocation. Check old author links, search/filter scopes, empty states, error states, keyboard access, and a narrow viewport.
>
> Run and record exit codes for `bunx prisma validate`, migration status and migration/backfill verification, targeted tests, `bunx vitest run`, `bunx tsc --noEmit`, `bunx eslint .`, and `bun run build`. Run existing browser smoke scripts and new multi-user browser checks against a local stack. If the repository has a preexisting failure, distinguish it from a new regression with evidence. Fix regressions introduced by this work. A passing unit suite alone does not establish that sharing works.
>
> Before calling the task done, inspect the final diff, confirm no secrets or generated artifacts were added, and complete every item in the checklist below. Mark each item `PASS`, `FAIL`, or `NOT RUN`, with a test name, command, screenshot, or short observation. Never mark an untested item as passed. If a requirement remains incomplete, keep it explicitly open in the report with the exact blocker and next step. Do not deploy or push without the user's authorization.

## Completion checklist

Copy this section into the agent's final report and replace each box with `PASS`, `FAIL`, or `NOT RUN`. Include evidence beside each result.

### Data and migration

- [ ] Existing users have exactly one default personal workspace; new users receive one, including concurrent first requests.
- [ ] Each old document is assigned to its author's personal workspace with the same ID, author, source, files, assets, chats, and accessible old link.
- [ ] The backfill is idempotent and the verifier reports zero unassigned or misassigned documents.
- [ ] Team creation atomically creates the team, an initial admin, and one default team workspace.
- [ ] Workspace/document uniqueness and move collisions return clear errors; no document is silently overwritten or deleted.

### Permissions and invitations

- [ ] The central permission service matches the plan's permission matrix for every actor and scope.
- [ ] A pending, expired, revoked, or wrong-email invitation grants no access; accepting a valid invite activates exactly the intended scope.
- [ ] A direct document recipient sees that document only. A personal workspace recipient sees its current and later documents only.
- [ ] Every active team member sees all documents in the default team workspace with the correct author. Only the document author can edit.
- [ ] Removing a team member or revoking a share blocks subsequent document, file, asset, and PDF requests. A removed author retains attribution but loses team access.
- [ ] No viewer can save, rename, move, delete, upload, change the main file, share, call author-only AI/chat, submit a compile, or cancel another user's job through a direct API request.
- [ ] Unknown document IDs, old slugs, job IDs, asset paths, and invitation tokens do not bypass authorization or reveal private content.
- [ ] Last-admin removal is rejected. Team admins affect only their team. Non-admins cannot use app-admin routes.

### Interface and admin

- [ ] Users can create and switch between at least two personal workspaces and create multiple documents in one workspace.
- [ ] The library shows the selected scope, document author, and `View` or `Edit` access. Search and filters do not mix private scopes unexpectedly.
- [ ] Invitation, sharing, move, revocation, and access-lost states are understandable and work on desktop and a narrow viewport.
- [ ] The viewer editor opens source, files, assets, and an available PDF without offering save or other write controls.
- [ ] The app admin can create teams, see teams/members/documents/authors, invite and remove members, and read the relevant audit events.
- [ ] Admin document inspection is read-only and audited. Team member removal identifies the actor in the audit trail.

### Verification and handoff

- [ ] Prisma validation and migration status pass; migration and rollback behavior were checked on a staging or disposable PostgreSQL database.
- [ ] Targeted permission, invitation, migration, and route tests pass with at least five distinct user fixtures.
- [ ] The full Vitest suite, TypeScript check, ESLint, and production build pass, or each existing failure is documented with baseline evidence.
- [ ] Browser checks cover author, viewer, unrelated user, team admin, and app admin, including acceptance and revocation.
- [ ] Existing save, autosave, file revision, LaTeX and Markdown compile, job, PDF preview, and download flows still work for authors.
- [ ] The final report lists changed files, migration order, required environment variables, exact commands and results, screenshots or observations, limitations, and any incomplete work.
- [ ] The final diff contains no secrets, live invite tokens, test credentials, temporary PDFs, or unrelated generated files.

Completion means every required product behavior is implemented and verified. A `FAIL` or `NOT RUN` entry remains open work and must be described plainly in the handoff.
