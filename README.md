# Runes AI

Runes AI is a LaTeX editor built with Next.js, Monaco, Prisma, Redis, and a separate Bun compilation worker. A document is a workspace: a selected main `.tex` file plus other TeX files, images, and `.bib` data in folders. Users edit source, save it, compile a PDF, and review AI prose suggestions before applying them.

## Local setup

1. Install dependencies with `bun install` and copy `.env.example` to `.env`.
2. Configure Postgres, Redis, `NEXTAUTH_SECRET`, and Google OAuth credentials. Set `OPENROUTER_API_KEY` to use AI suggestions.
3. Start Postgres, Redis and the worker with `docker compose up -d`, then apply the Prisma schema with `bunx prisma migrate deploy`. The worker image contains its own Tectonic, so no engine container is needed unless `TECTONIC_ENGINE=docker-exec` is pinned during a rollback.
4. Start the web app with `bun run dev`. 

The optional `DEV_AUTH_BYPASS=1` flag enables `/api/dev-login` only in development for local smoke testing. Use it with a loopback-bound server, for example `DEV_AUTH_BYPASS=1 bun run dev -H 127.0.0.1`. The flag is off by default. The test cookie is signed with `AUTH_SECRET` or `NEXTAUTH_SECRET` and expires after one day.

## Workspaces and file trees

Every document owns a set of files addressed by normalized relative paths such as
`chapters/methods.tex`. `Document.mainFilePath` selects the compile entry point, and
`GET /api/document/[slug]` returns both the flat file list and the nested tree.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/document/[slug]` | document, main file, file metadata, tree |
| `PUT /api/document/[slug]` | save title and one or more files (`files[]` with `baseRevision`) |
| `POST /api/document/[slug]` | enqueue a compile of the current snapshot |
| `GET|PUT|DELETE /api/document/[slug]/file?path=` | read, create, edit, delete one file |
| `POST /api/document/[slug]/upload` | multipart upload for images and other assets |
| `POST /api/document/[slug]/move` | rename or move a file, main pointer included |
| `POST /api/document/[slug]/main` | choose the main `.tex` file |
| `GET /api/document/[slug]/asset?path=` | bytes of a stored binary asset |

Ownership is re-checked on every call from the session plus the slug, so ids and paths
from another account resolve to `404`. Paths are normalized before they touch the
database or a compile directory: absolute paths, `..`, empty and ambiguous segments,
control characters, names that differ only by case, unsupported extensions and oversize
bytes are rejected. The worker validates every path again when it materializes a job in
its own directory under `COMPILE_TMP_DIR`, never follows links, and runs the engine with
`--untrusted` so shell escape is not available.

Server-side limits live in `src/lib/workspace-paths.ts`: 5 MB per file, 1 MB per text
file, 500 files and 50 MB per workspace, path depth 12. Uploads are capped at 8 MB per
request and a PDF above 50 MB is refused.

### Snapshots and caching

A compile captures an immutable snapshot: the transitive closure of `\input`, `\include`,
`\includegraphics`, `\bibliography` and `\addbibresource` from the main file, each file's
checksum, the main file choice, the engine name and version, and the engine options. The
digest of that manifest is the cache key, so

- identical bytes answer from the finished job instead of compiling again,
- an in-flight job for the same digest is shared rather than duplicated,
- editing, moving, renaming or deleting anything the main file actually reads produces a
  new digest, while editing a file the main file does not reference changes nothing,
- the key includes the user id, so a cached artifact is never shared between accounts.

Jobs materialize that snapshot, so edits made after the click cannot change a running
compile; the editor marks the PDF stale instead.

## Compile pipeline and latency

Click to preview is: save dirty files, `POST /api/document/[slug]`, Redis queue, worker,
snapshot materialization, Tectonic, PDF into Redis, job status, browser poll, PDF fetch,
preview. Every stage records a timestamp under the job id
(`src/types/compilation.ts` `StageTimings`) and the worker logs one `[TIMING]` line per
job with queue wait, materialize, spawn, engine and PDF read.

Reproduce with the same harness used for the before/after numbers in the PR:

```bash
node scripts/bench/bench.mjs --workload small --iterations 10 --poll 0:200 --out /tmp/small.jsonl
node scripts/bench/bench.mjs --workload project --workspace --iterations 10 --out /tmp/project.jsonl
node scripts/bench/bench.mjs --workload project --workspace --iterations 3 --concurrency 3 --out /tmp/conc.jsonl
node scripts/e2e-workspace.mjs --base http://127.0.0.1:3000
```

Fixed waits that were measured and removed: the worker slept 1,000 ms after every job,
the compiler slept 500 ms after Tectonic exited, and the editor polled at a 2,000 ms
interval so nothing could be seen before 2 s. Polling now starts immediately, runs at
200 ms for the first 5 s, then backs off to 1 s, and never overlaps requests.

The engine is the dominant remaining cost when the package cache is cold: a first
compile with an empty cache downloaded 42.7 MB and took 88 s in this environment,
against about 0.42 s warm. `Dockerfile.worker` therefore pins the Tectonic version,
installs it into the isolated worker image and warms the bundle cache at build time.

Concurrency is `WORKER_CONCURRENCY` (default 2 on a 4 CPU / 4 GB host) with a
`COMPILE_TIMEOUT_MS` per job, one directory per job, and bounded engine output. Two
things must stay true: the queue read uses a dedicated Redis connection because `BLPOP`
parks its connection and would otherwise delay the writes that publish results, and the
loop does not sleep between jobs.

## Editor behavior

- Monaco provides LaTeX highlighting, line numbers, find, selections, undo and redo, and local command snippets.
- AI prose completion appears as ghost text after a pause in eligible document prose. Tab accepts it. The editor can turn AI completion off for the current session.
- Paraphrase sends a selected prose range to the server. The server masks protected LaTeX fragments before the provider call and validates their exact restoration. The review panel shows a diff; Accept makes one undoable edit, and Reject leaves source untouched.
- Save and compile use accepted source only. The PDF pane reports when its PDF is older than the current source.

## Migrating existing single-source documents

The migration is additive and repeatable; `Document` keeps its id, slug, title, owner and
chat relations, and `Document.content` is kept in sync with the main file so old clients
and a rollback still work.

```bash
bunx prisma migrate deploy                 # adds workspace_files and mainFilePath
bun run migrate:workspaces --apply      # creates main.tex for every document
bun run migrate:workspaces --verify     # bytes, owner, slug, title, checksums
bun run migrate:workspaces --rollback   # restores Document.content from main.tex
```

Any read of a document also migrates it on demand, so a partially backfilled database
serves traffic correctly. `--apply` is a no-op for documents that already have files, and
existing `/document/[slug]` URLs are unchanged. `content` stays nullable and is only
dropped by a deliberate later change once no client reads it.

## Cross-document references

Labels and references work across every TeX file included by one main file, because all
of those files are compiled in one engine run. References between **two independently
compiled main documents** are not supported: that needs exported `.aux` files, an
explicit dependency between workspaces, rebuild ordering, and stale-label handling. It is
deliberately out of scope here rather than partially approximated.

## Checks

Run `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/vitest run`, `./node_modules/.bin/eslint .`, and `bun run build`. Full repository lint still reports older issues outside the editor flow; see [deliverables.md](deliverables.md).

For the local browser check, install Python Playwright and Chromium, start the web app with `DEV_AUTH_BYPASS=1` and the worker, then run `RUNES_BASE_URL=http://127.0.0.1:3000 python scripts/browser-smoke.py`. The script creates and removes its own test document. It stubs AI replies, then verifies a real PDF compile through the worker.
