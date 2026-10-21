# Delivery and plan audit

Reviewed on 2026-10-21 against `requirements.md`, `plan.md`, the current source, automated checks, and a local browser run.

## Starting state and work completed

The worktree was clean at the start of this review. Earlier checkpoints had added Monaco, AI routes, a proposal engine, job ownership checks, and 80 passing pure tests. The existing handoff had no browser or API test evidence. This review found that AI quotas were per-process counters, protected LaTeX was masked only in the browser, the development cookie was unsigned, autosave could capture old source, and the logo blocked toolbar clicks.

This pass moved AI quotas and one-request-per-user locks into Redis, moved placeholder masking and restoration onto the server, signed and gated the development test cookie, fixed editor save and cancellation paths, repaired responsive controls, and added route and browser tests. It also kept job ownership data alive for the full result lifetime. `README.md` now describes the implemented app instead of planned features.

## Requirement evidence

| Requirement | Current result and evidence |
|---|---|
| R1: source editor and PDF workflow | Monaco, local LaTeX snippets, save, autosave, title, editor/split/preview modes, compile, PDF preview and download are present. `scripts/browser-smoke.py` exercised open, edit, save/reload, real worker compile, preview, download, and the stale-PDF notice. The source model stays keyed to the document. |
| R2: AI prose completion | The Monaco inline provider debounces 400 ms, aborts older requests, checks model/version/cursor/document and Monaco cancellation, and inserts at an empty range. The browser test used a stubbed AI reply, accepted ghost text with Tab, and verified the insertion. Pure tests cover context suppression and unsafe output. Redis enforces 60 requests per minute per user and one active provider call per user. |
| R3: paraphrase | The server checks authentication, ownership, Zod limits, Redis quota, and one active call per user. It masks commands, citations, references, math, environments, and escaped LaTeX characters before calling the provider. It restores only exact ordered placeholders and rejects new control sequences. Empty, partial-word, structural, comment, math, and unsupported selections are refused. |
| R4: review and exact acceptance | The review panel shows original text and an accessible word diff, with a full comparison fallback for large input. The browser test selected the second of two identical sentences, rejected, accepted, undid, redid, saved, and reloaded. It also tested edits during a delayed request and while a proposal was visible. Both paths blocked an old proposal. Navigating to another document while a request was pending left the next source and review state untouched. |
| R5: access and reliability | AI and document routes check ownership. Job status, cancellation, and PDF routes check the stored submitting user, including after completion. Route tests use owner and other-user identities and verify 404 denials, anonymous 401, input failures, malformed and failed provider output, timeout, missing configuration, quota, and concurrent-call denial. Errors and production logs omit selected text and raw provider responses. |

Pending proposals stay in React state. The AI routes never write document content; only Accept changes the Monaco model. `executeEdits` with undo stops makes that replacement one undoable edit. Compilation reads saved accepted source.

## Verification

| Check | Result |
|---|---|
| TypeScript, `./node_modules/.bin/tsc --noEmit` | Passed. |
| Tests, `./node_modules/.bin/vitest run` | 107 passed across six files at the latest complete run. |
| Production build, `bun run build` | Passed with network access for the existing Google font imports. Next.js warned that the middleware filename convention is deprecated. |
| Browser, `RUNES_BASE_URL=http://127.0.0.1:3000 python scripts/browser-smoke.py` | Passed with stubbed AI responses. It created and removed its own documents. The local Postgres, Redis, worker, Docker, and Tectonic image produced a 4,671-byte PDF, which the browser previewed and downloaded. |
| Full lint, `./node_modules/.bin/eslint .` | Still fails on older repository issues. It began this review at 46 errors and 24 warnings; the latest run before the final small cleanup had 30 errors and 14 warnings. No lint rule was relaxed. |
| Whitespace, `git diff --check` | Passed. |

Installed versions are `monaco-editor` 0.57.0, `@monaco-editor/react` 4.7.0, `diff` 9.0.0, and Vitest 3.1.1. This work used the existing `bun.lock` workflow and did not change either lockfile.

## Remaining limits

- `OPENROUTER_API_KEY` is empty in the local environment. AI responses were stubbed in browser and route tests; a real-provider smoke test remains unavailable until a key is supplied. The UI reports provider unavailability without blocking editing.
- Google OAuth credentials are empty locally. The browser test used the explicitly enabled local development login. Production OAuth sign-in was not exercised.
- The lexical LaTeX scanner is conservative and is not a full TeX parser. Complex macro expansion or unusual catcode rules may be rejected.
- The existing Tectonic Docker command has a timeout but no explicit CPU, memory, network, or container privilege limits. Compiler sandbox hardening is separate work.
- Full repository lint still covers older landing, hook, modal, and legacy compiler files. The editor and AI files changed in this pass have no lint errors.

This is a single-source-document workflow. The sample file tree is not a multi-file project system, and no collaboration or rich-text editing is claimed.
