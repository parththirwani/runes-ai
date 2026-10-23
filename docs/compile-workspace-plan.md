# Compile performance and multi-file workspace plan

## Purpose and scope

Make the time from clicking **Compile** to seeing the PDF measurable and shorter. Replace the current one-source `Document` with a workspace that can hold a main `.tex` file, included `.tex` files, images, bibliography data, and other explicitly supported assets. A main file must be able to use relative paths to those files. Labels and references must work across TeX files included in the same compilation.

This plan covers the compiler, queue, storage, API, editor file tree, migration, and verification. It does not cover the broader marketing and UI redesign in `ui-revamp-plan.md`.

The implementation agent should work in a separate worktree and create a feature branch from the latest `origin/ai-native-build`. This plan is uncommitted in the existing checkout, so copy it into the new worktree as the first step and commit that copy only on the feature branch. Open a PR targeting `ai-native-build`. Do not edit, commit, stash, or reset the existing checkout, and do not merge the PR. The PR must contain the implementation and measured results, not this plan alone.

## Current system and confirmed latency points

The editor saves dirty source with `PUT /api/document/[slug]`, then sends `POST /api/document/[slug]`. That route reads one `Document.content` string and enqueues it in Redis. One worker writes the string to a temporary `.tex` file, invokes Tectonic through Docker, puts the PDF in Redis, and marks the job complete. The editor polls job status and then downloads the PDF.

| Stage | Current evidence | Change to investigate or make |
| --- | --- | --- |
| Save before compile | `DocumentEditor.tsx` awaits `handleSave()` before its compile request when source is dirty. | Time save separately. Preserve the guarantee that the compiled snapshot matches accepted source. Avoid an unnecessary save when no file changed. |
| Queue capacity | `worker/worker.ts` processes one job at a time and sleeps 1,000 ms after each job. | Remove the post-job sleep; `BLPOP` already waits for work. Add bounded parallel workers if concurrent-job measurements warrant it. |
| Compiler launch | `worker/latex-compiler.ts` invokes `docker exec` against the warm Tectonic container configured by `docker-compose.yml`, or `docker run` if that configuration is absent. | Measure command startup and Tectonic separately. Run Tectonic directly in an isolated compiler worker when feasible; keep package caches warm. Ensure the fallback cannot silently become the normal production path. |
| Fixed compiler delay | `worker/latex-compiler.ts` waits 500 ms after Tectonic exits before checking the PDF. | Remove the wait. Process exit and a successful output-file check are the completion signal. |
| Tectonic work | The current timing wraps file creation and compiler execution but does not separate startup, package fetching, TeX passes, and file I/O. | Add per-stage timings. Profile cold and warm runs before changing the engine or cache strategy. |
| Result visibility | `DocumentEditor.tsx` first polls after 2 seconds and repeats every 2 seconds. | Poll immediately after enqueue, then use a measured interval or server-sent status updates. Prevent overlapping polls. |
| Duplicate compiles | Every accepted compile request creates a new job for the saved source. | Reuse an in-flight job or successful artifact for the same immutable workspace snapshot and compiler configuration. |
| PDF transfer | The worker writes the PDF to Redis; the API reads it and sends it to the browser as a separate request. | Measure result storage, API transfer, and browser preview rendering before optimizing them. |

The listed 1,000 ms, 500 ms, and 2,000 ms intervals are code facts, not a measured end-to-end latency breakdown. `BLPOP(..., 5)` is a blocking wait for new work and does not itself impose five seconds on an arriving job. Do not claim a speedup until before-and-after timings show it.

## Requirements

### Compile performance

1. Record timestamps for click, save start/end, compile API start/end, enqueue, dequeue, snapshot materialization, compiler process start/end, PDF read/store, job completion, status observed, PDF download, and preview ready. Associate them with a job ID without logging document source, asset bytes, secrets, or private file contents.
2. Produce a baseline for a small TeX file, a workspace with included files and images, and at least two concurrent compiles. Record cold and warm compiler behavior. Report median and p95 end-to-end time plus each stage's duration. Include queue depth and PDF size. Run the same workload after changes.
3. Remove fixed waits that add latency without correctness value. Keep compile timeouts, cancellation behavior, and cleanup of temporary files.
4. Limit concurrent compiles by measured CPU and memory capacity. Do not allow one user's large workspace to consume unbounded worker capacity or block everyone indefinitely.
5. Reuse a successful PDF for an identical snapshot and reuse an active job for a duplicate request. The cache key must include file contents, paths, selected main file, compiler version and options, and any other input that affects output. A changed input must not receive an old PDF.
6. Keep the current authenticated job-status and PDF access checks. Expose errors and stage status clearly in the editor.

### Workspace and cross-file compilation

1. A user can create a workspace, select its main `.tex` file, and manage a nested tree of TeX source, images, `.bib`, and explicitly supported text/assets. The UI supports create, upload, open, edit, rename, move, delete, and main-file selection. A binary file has a preview or metadata view instead of a text editor.
2. The main file can use normal relative paths, including `\input{chapters/methods}`, `\include{chapters/results}`, `\includegraphics{figures/plot.png}`, and bibliography references. `\label` and `\ref` work across files that belong to the same main-file compile. Keep original LaTeX syntax; do not concatenate sources or rewrite include commands in the browser.
3. Every compile uses an immutable, consistent set of saved file revisions. Edits after enqueue make the displayed result stale but cannot change the running job. A failed save must not lead to a compile of partially updated source.
4. Existing single-source documents migrate to a workspace with `main.tex`. Preserve document IDs, slugs, titles, owners, chat associations, and current document URLs. Confirm migration is repeatable and has a rollback/restore path before dropping the old content column.
5. A user can access only their own workspaces, files, jobs, and PDFs. Validate normalized relative paths and reject absolute paths, `..`, duplicate or ambiguous names, symlinks, unsupported file types, and files exceeding defined per-file and per-workspace limits. Materialize each job in its own compile directory. Restrict compiler filesystem and network access; do not enable shell escape.
6. Return compiler errors with the workspace file path and line when the engine provides them. Missing includes and images must yield a useful error rather than a generic timeout.
7. Preserve existing save, autosave, accepted AI edits, PDF preview/download, rate limiting, and document navigation. AI actions continue to operate on the currently open text file and never modify other files implicitly.

### Cross-reference boundary

The required first release supports references across files included in one main-file compilation. References between **two independently compiled main documents** are a separate feature because they require exported `.aux` files, explicit dependencies, rebuild ordering, and handling of stale labels. If that behavior is needed, design it as a follow-on phase and describe it plainly in the PR. Do not claim support for it based on `\input` alone.

## Deliverables

1. A profiling report in the PR with workload definitions, environment, raw stage timings or a reproducible timing script, baseline and after-change median/p95 values, and an explanation of which changes produced the improvement.
2. Instrumented compile API, queue, worker, and browser flow with one job correlation ID and safe stage timestamps.
3. Compiler and queue changes that remove fixed waits, address the measured launch/queue costs, bound concurrency, and reuse identical work safely.
4. Prisma migrations and storage code for workspace files, selected main file, revision/checksum metadata, and binary assets. Include a local development storage path and a production storage configuration; do not put temporary compile directories in permanent project storage.
5. Authenticated workspace/file APIs with validation, optimistic revision checks or equivalent conflict protection, and an immutable compile snapshot contract.
6. A real editor file tree and file tabs or equivalent navigation, upload and file operations, main-file selection, stale-PDF indication, and file-specific compiler errors.
7. Migration of existing documents plus a documented backfill and verification procedure.
8. Focused unit, API, migration, worker integration, and browser tests; updated README and deployment configuration; a PR description listing commands run, results, limitations, and before/after latency measurements.

## Implementation sequence

### 1. Establish a reproducible baseline

- Check repository instructions and current behavior. Run existing typecheck, tests, build, and the browser compile smoke test where services are available.
- Add stage timestamps to `src/app/api/document/[slug]/route.ts`, `producer/queue.ts`, `worker/worker.ts`, `worker/latex-compiler.ts`, and the compile/download flow in `DocumentEditor.tsx`. Keep a consistent wall-clock correlation value plus monotonic durations for each process.
- Build a benchmark fixture with a minimal file, nested TeX includes, a bibliography, and an image. Measure cold and warm runs and a concurrent queue. Store the commands and output summary in the PR.

### 2. Remove measured overhead without changing the data model

- Remove the worker's post-job sleep and the compiler's 500 ms delay. Make result-file checks immediate and deterministic.
- Check whether the configured warm Tectonic container is actually used in the measured deployment. Prefer a direct compiler invocation from an isolated worker image with a persistent package cache if startup overhead is material. Keep separate per-job working directories, timeouts, cleanup, and bounded resource use.
- Check whether polling materially delays display. Start the first status request immediately, prevent overlapping requests, and choose polling or push updates based on deployment simplicity and measured benefit.
- Add identical-job deduplication and completed-result reuse only after defining the full snapshot key in step 4. Do not cache on document slug alone.

### 3. Add the workspace data model and migrate records

- Keep `Document` as the stable user-facing workspace identity for the first migration, so existing IDs, slugs, routes, and chat foreign keys survive. Add a file model keyed by `(documentId, normalizedPath)` with type, size, checksum, revision, timestamps, and text content or a binary storage key. Add a selected-main-file path or ID to `Document`.
- Backfill every existing `Document.content` into `main.tex` and set it as main. Deploy code that can read migrated rows before removing the legacy column. Verify counts and content hashes, and retain a backup/rollback procedure.
- Choose binary storage appropriate to deployment, with a local development adapter and configured production backend. Put file size, workspace size, file count, and path-depth limits in server-side validation.

### 4. Implement file APIs and immutable snapshots

- Add authenticated endpoints for tree listing, file reads/writes, upload, create, rename/move, delete, and main-file selection. Keep ownership checks in each operation. Use revision preconditions so two saves cannot silently overwrite one another.
- Before enqueue, save the current text file if dirty, then capture a consistent manifest of all workspace paths and content hashes. A snapshot must not mix revisions from different points in time. Store or reference the exact bytes needed by the worker for the job lifetime.
- Build a deterministic digest from that manifest and compiler configuration. Reuse an active job or completed artifact with the same digest; invalidate naturally when any path, byte, main-file choice, or compiler input changes.

### 5. Compile the workspace snapshot

- Materialize files under their validated relative paths in a unique job directory. Set the selected main file as Tectonic's entry file and preserve directory layout so standard LaTeX file references resolve.
- Reject unsafe paths again at materialization. Never follow user-controlled symlinks. Keep output and temporary files separate from stored workspace files.
- Capture compiler logs safely, map errors back to workspace paths and lines, and keep enough diagnostic text for a user to fix a missing include or package without exposing server paths.
- Store the PDF and compile result against the snapshot digest and user/workspace identity. Mark the preview stale if any current file revision differs from the compiled snapshot.

### 6. Replace the outline-only file tree

- Show actual folders and files in `FileTree.tsx`; retain the section outline as a separate view for the active TeX file. Opening a text file gives Monaco a stable URI per workspace path so model state does not bleed between files.
- Add file actions, upload progress and errors, main-file indicator, and clear handling for binary assets. Keep keyboard access, touch access, and narrow-screen layouts usable.
- Compile from the chosen main file, not necessarily the open file. Show which snapshot was compiled and which changed files make the PDF stale.

### 7. Verify and document

- Run the test matrix below and the before/after benchmark on the same machine and service configuration. Inspect the final diff for accidental changes to auth, AI proposal acceptance, or document URLs.
- Document storage setup, migration order, backup/rollback steps, supported asset types and limits, local compile setup, and the cross-reference boundary in `README.md`.
- Open the PR only after code, migration, tests, benchmark evidence, and screenshots of workspace states are reviewable. Do not merge it.

## Test matrix and acceptance criteria

| Area | Required checks |
| --- | --- |
| Baseline and speed | Re-run identical small, multi-file/image, cold/warm, and concurrent workloads. Report median/p95 click-to-preview and stage durations. Fixed waits must be gone; queue and compiler changes must show their actual effect. No new timeout or correctness regression. |
| Migration | Existing document becomes `main.tex` with byte-identical source. ID, slug, title, owner, chat relations, and URL still work. Re-running the backfill does not duplicate files. |
| File APIs | Create/read/edit/rename/move/delete nested files; upload a supported image and `.bib`; select a new main file; reject duplicate paths, invalid names, unsupported types, oversize files, and stale revision writes. |
| Security | Anonymous and wrong-owner access to workspace files, jobs, and PDFs fails. Paths with `..`, absolute paths, separators or Unicode variants used to evade validation, and symlink attempts cannot escape the job directory. Compiler cannot use shell escape. |
| LaTeX | Nested `\input` and `\include`, `\includegraphics`, bibliography, labels and references across included files, missing include/image, malformed TeX, and a main file in a subfolder compile or fail with correct diagnostics. |
| Snapshot and cache | An edit during compilation cannot change that job's PDF. Identical snapshots reuse an active or completed result. Editing, moving, renaming, or deleting any input invalidates the old result. Different users cannot share authorization to a cached artifact. |
| Editor | Open and switch files, save/autosave, accepted AI edit in the active file, compile from main, stale preview, PDF download, file-specific errors, keyboard actions, and mobile tree behavior work end to end. |
| Worker reliability | Two concurrent jobs run within configured limits; one failure does not block the queue. Timeout and worker restart leave recoverable job state and remove job directories. |

Run `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/vitest run`, `./node_modules/.bin/eslint .`, and `bun run build`. Run the existing browser smoke test and extend it for real multi-file compilation with local Postgres, Redis, worker, and Tectonic. Report exact pass/fail results and environmental blockers. Do not describe a test as passing if it was not run.

## Completion checklist

- [ ] Stage timings identify the dominant costs and the PR contains before/after numbers.
- [ ] The fixed worker and compiler waits are removed, with no output-file race.
- [ ] Compile capacity, timeouts, cleanup, and repeated-job reuse behave under concurrent load.
- [ ] Existing documents migrate without content loss or broken links.
- [ ] Users can manage and compile a nested workspace of TeX and supported assets.
- [ ] Cross-file labels and references work within one main-file compilation.
- [ ] Snapshot, cache, and stale-preview behavior are correct after file changes.
- [ ] Ownership, path isolation, limits, and compiler restrictions pass tests.
- [ ] Typecheck, tests, build, browser compile, and benchmark results are recorded in the PR.
