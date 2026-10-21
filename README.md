# Runes AI

Runes AI is a single-document LaTeX editor built with Next.js, Monaco, Prisma, Redis, and a separate Bun compilation worker. Users can edit source, save it, compile a PDF, and review AI prose suggestions before applying them. The file tree shows sample entries; documents currently store one source string.

## Local setup

1. Install dependencies with `bun install` and copy `.env.example` to `.env`.
2. Configure Postgres, Redis, `NEXTAUTH_SECRET`, and Google OAuth credentials. Set `OPENROUTER_API_KEY` to use AI suggestions.
3. Start Postgres, Redis, the worker, and Tectonic with `docker compose up -d`, then apply the Prisma schema with `bunx prisma migrate deploy`.
4. Start the web app with `bun run dev`. The compose worker uses the `tectonic` service for PDF compilation.

The optional `DEV_AUTH_BYPASS=1` flag enables `/api/dev-login` only in development for local smoke testing. Use it with a loopback-bound server, for example `DEV_AUTH_BYPASS=1 bun run dev -H 127.0.0.1`. The flag is off by default. The test cookie is signed with `AUTH_SECRET` or `NEXTAUTH_SECRET` and expires after one day.

## Editor behavior

- Monaco provides LaTeX highlighting, line numbers, find, selections, undo and redo, and local command snippets.
- AI prose completion appears as ghost text after a pause in eligible document prose. Tab accepts it. The editor can turn AI completion off for the current session.
- Paraphrase sends a selected prose range to the server. The server masks protected LaTeX fragments before the provider call and validates their exact restoration. The review panel shows a diff; Accept makes one undoable edit, and Reject leaves source untouched.
- Save and compile use accepted source only. The PDF pane reports when its PDF is older than the current source.

## Checks

Run `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/vitest run`, `./node_modules/.bin/eslint .`, and `bun run build`. Full repository lint still reports older issues outside the editor flow; see [deliverables.md](deliverables.md).

For the local browser check, install Python Playwright and Chromium, start the web app with `DEV_AUTH_BYPASS=1` and the worker, then run `RUNES_BASE_URL=http://127.0.0.1:3000 python scripts/browser-smoke.py`. The script creates and removes its own test document. It stubs AI replies, then verifies a real PDF compile through the worker.
