# Runes AI

Runes AI is a document editor built with Next.js, Monaco, Prisma, Redis, and a separate Bun compilation worker. Documents are either LaTeX (`.tex`, compiled with Tectonic) or Markdown (`.md`, compiled with pandoc + Tectonic). Users can edit source, save it, compile a PDF, and review AI prose suggestions before applying them. Markdown documents support owned image/asset uploads shown in a safe reading preview.

## Local setup

1. Install dependencies with `bun install` and copy `.env.example` to `.env`.
2. Configure Postgres, Redis, `NEXTAUTH_SECRET`, and Google OAuth credentials. Set `OPENROUTER_API_KEY` to use AI suggestions.
3. Start Postgres, Redis, the worker, and Tectonic with `docker compose up -d`, then apply the Prisma schema with `bunx prisma migrate deploy`.
4. Start the web app with `bun run dev`. The compose worker uses the `tectonic` service for PDF compilation.

The optional `DEV_AUTH_BYPASS=1` flag enables `/api/dev-login` only in development for local smoke testing. Use it with a loopback-bound server, for example `DEV_AUTH_BYPASS=1 bun run dev -H 127.0.0.1`. The flag is off by default. The test cookie is signed with `AUTH_SECRET` or `NEXTAUTH_SECRET` and expires after one day.

## Markdown documents

- Creation asks for a format (Markdown or LaTeX) and seeds an appropriate starter template server-side. Existing documents backfill to LATEX; the dashboard shows a format badge, a format filter, and format-aware file names (`title.md` / `title.tex`).
- Markdown editing uses a Monaco Markdown model with prose-friendly snippets. The editor offers Reading (safe client-side render of the saved document: GFM, math via KaTeX, images restricted to the document's own asset URLs) and Source/Split/PDF views. AI completion is suppressed inside code, math, links, raw HTML, headings, lists, tables, and front matter.
- Markdown PDF compilation runs in the worker: `pandoc --from=gfm+tex_math_dollars-raw_html --pdf-engine=tectonic` inside a throwaway job directory with source validation, a 25 MiB output cap, and an exec timeout (pandoc's own `--sandbox` is unusable because it blocks the external engine process). Set `PANDOC_BIN` and `PDF_ENGINE_BIN` to the binaries on the worker host; the provided `Dockerfile.worker` pins pandoc 3.6.3 and tectonic 0.15.0 with checksums. LaTeX compiles keep using the docker sibling container unless `TECTONIC_BINARY` points to a local tectonic binary.
- Images upload through `POST /api/document/[slug]/assets` (owner-only, type sniffed from magic bytes, per-document quota) and serve from `/api/document/[slug]/assets/...` with `nosniff` and `no-store`. Uploads are snapshotted into the compile job, so compiles are reproducible and never read arbitrary paths.
- AI paraphrase/completion is format-aware: the server re-derives the document format from the owned row, masks Markdown protected syntax (code spans, math, links, autolinks) before the provider call, and refuses any response that drops tokens or introduces raw HTML, new URLs, or Markdown syntax.

## Editor behavior

- Monaco provides LaTeX highlighting, line numbers, find, selections, undo and redo, and local command snippets.
- AI prose completion appears as ghost text after a pause in eligible document prose. Tab accepts it. The editor can turn AI completion off for the current session.
- Paraphrase sends a selected prose range to the server. The server masks protected LaTeX fragments before the provider call and validates their exact restoration. The review panel shows a diff; Accept makes one undoable edit, and Reject leaves source untouched.
- Save and compile use accepted source only. The PDF pane reports when its PDF is older than the current source.

## Checks

Run `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/vitest run`, `./node_modules/.bin/eslint .`, and `bun run build`. Full repository lint still reports older issues outside the editor flow; see [deliverables.md](deliverables.md).

For the local browser check, install Python Playwright and Chromium, start the web app with `DEV_AUTH_BYPASS=1` and the worker (with `PANDOC_BIN`/`PDF_ENGINE_BIN` set), then run `RUNES_BASE_URL=http://127.0.0.1:3000 python scripts/browser-smoke.py`. Point `RUNES_CHROMIUM` at your Chromium binary if it is not at `/usr/bin/chromium` (a Playwright-installed Chromium works). The script creates and removes its own test documents for both formats. It stubs AI replies, then verifies a real LaTeX PDF compile and a real Markdown PDF compile through the worker, including the asset store, reading preview, remote-image rejection, and the `.md` source download.
