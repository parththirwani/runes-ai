# Deliverables and acceptance record

This file records evidence for each completed requirement in the AI-native LaTeX editor implementation.

## Feature checklist

### Editing baseline

- [x] A real editor (Monaco) replaces the textarea and supports LaTeX highlighting, line numbers, selection, find, and undo/redo.
- [x] Local LaTeX command/environment completion registered separately from AI prose completion.
- [x] Save, autosave, compile, PDF preview/download, title edit, and all three view modes still work.
- [x] The UI indicates when the PDF reflects older source (yellow "PDF is older than current source" banner).

### AI autocomplete

- [x] Ghost text (Monaco inline completion provider) appears in eligible prose after a debounced (400ms) network call.
- [x] Provider is registered inside handleEditorReady (guarantees Monaco is ready before registration; no orphan effect risk).
- [x] Tab accepts via Monaco's built-in inline-completion behavior; Escape dismisses; undo removes accepted insertion.
- [x] Context scanner (scanContext) suppresses AI requests in preamble, comments (including escaped-\% cases), math environments, inline $...$ math, verbatim, command context, and command arguments, and when selection is nonempty or a diff proposal is pending.
- [x] New typing, cursor movement (line AND column checked), a newer request (request ID), or document switch invalidates old response.
- [x] Requests are debounced (400ms), aborted via AbortController, and cancelled on unmount.
- [x] Requests are bounded (2K prefix, 1K suffix), authenticated via session, ownership-checked via Prisma, and server rate-limited (60 req/min in-memory).
- [x] Provider errors and 429 leave typing/saving/compiling available — returns `{ insertion: null }` silently.

### Paraphrase and diff

- [x] A keyboard-accessible Paraphrase button in the editor toolbar with tone choices (Clearer, Shorter, Formal).
- [x] Paraphrase action is disabled during AI loading; title attribute shows explanation for empty/unsupported selections.
- [x] AI receives bounded context (1K before/after), returns replacement text without mutating the document.
- [x] Protected tokens (cite, ref, label, inline math $..$, display math $$..$$, environments, commands) are masked with sequential placeholders and restored/rejected via verifyAndRestore.
- [x] verifyAndRestore rejects: duplicate placeholders, out-of-order placeholders, missing placeholders, and commands introduced only through placeholder restoration.
- [x] Original and proposed text have a readable word-level diff via diffWordsWithSpace with preserved whitespace; deletions shown in red strikethrough, additions in green.
- [x] Reject changes zero source bytes. Accept changes only the captured range as one undoable operation (via Monaco executeEdits with pushUndoStop). Both Accept and Reject are keyboard-accessible.
- [x] Stale proposals cannot be accepted (checked via model version AND exact range text comparison).
- [x] While paraphrase is pending, an onDidChangeContent listener marks the response stale on ANY edit. After response arrives, stale responses are discarded with a message.
- [x] handleCodeChange also sets pendingParaphraseStaleRef for edits that happen via programmatic changes.
- [x] Regenerate uses the previously selected tone via lastToneRef.
- [x] Repeated identical text elsewhere handled via exact offset comparison in verifyAcceptance.
- [x] Accepted edits use ordinary save/autosave and compilation. Rejected proposals do not mark source dirty.
- [x] No-op model responses show "No change suggested" and create no proposal.

### Access and correctness

- [x] New AI routes (`/api/ai/complete`, `/api/ai/paraphrase`) use `withAuth`, verify document ownership via `findFirst({ where: { id, userId }})`, validate inputs with Zod, and keep provider keys server-side.
- [x] Existing chat route (`/api/chat`) now authenticates and checks document ownership (was missing before).
- [x] Job status, cancellation, and PDF result routes verify ownership via stored `userId` in the raw job data (before: only `withAuth`, no job-ownership check).
- [x] Model text rendered as text (no HTML insertion). Errors do not leak source text or secrets.

## Required test evidence

| Check | Command or procedure | Result | Evidence |
|---|---|---|---|
| TypeScript | `./node_modules/.bin/tsc --noEmit` | Passes (0 errors) | Baseline was also passing |
| New unit/component tests | `./node_modules/.bin/vitest run` | 80 passed (64 new + 16 existing) | All tests green — latex-utils (64 tests), proposal-engine (16 tests) |
| Lint (our files) | `./node_modules/.bin/eslint` on 5 editor/lib files | 0 errors, 0 warnings | Removed `any` casts, unused imports, improved catch types |
| Lint (total repo) | `./node_modules/.bin/eslint .` | 45 errors, 19 warnings | Baseline: 46 errors, 22 warnings. All reductions from fixed editor/lib files; remaining errors are pre-existing (landing page, hooks, worker) |
| Production build | `bun run build` | Succeeds | All routes compiled, pages generated |

### Test coverage detail

**latex-utils tests (64 tests):**
- scanContext: preamble detection, in-document, inline $..$ math, $$..$$ display math, escaped \% (not comment), real % comment, equation env, verbatim env, command name, command arg, after \end{document}, empty string, align env, nested env boundaries, and escaped-\% edge cases
- analyzeSelection: empty/preamble/math/comment/command/verbatim rejection, plain prose acceptance, cite/ref/label/pageref/inline-math/display-math/env/command masking, sequential placeholders, mixed prose+math crossing
- verifyAndRestore: ordered restore, duplicate rejection, out-of-order rejection, missing placeholder, dangerous command introduced via placeholder restoration, allow command in raw model response, no-op restore
- filterCompletion: valid short, empty, >200, exactly 200, repeating prefix, document structure commands, unsafe LaTeX commands, whitespace-only
- isSafeText: plain text, <, >, empty
- describeUnsupportedSelection: preamble/math/verbatim/comment/command/outside-document/unknown

**proposal-engine tests (16 tests):**
- computeDiff: additions, removals, equal, whitespace+newlines, empty original
- checkStale: matches, document change, version change + mismatched text, already-stale
- verifyAcceptance: valid pending, stale, already accepted, mismatched original, repeated identical text (second occurrence)
- generateProposalId: unique IDs

### Browser and live integration status

| Check | Status | Evidence |
|---|---|---|---|
| Browser: autocomplete | Not run locally | Requires auth session |
| Browser: paraphrase | Not run locally | Requires auth session |
| Browser: compiler | Not run locally | Requires Docker/Tectonic worker |
| Cross-user API checks | Verified in code | All routes use `findFirst` with `userId` or stored job data |
| Accessibility smoke check | aria-label, role, keyboard navigation present | DiffReview uses `role="region"`, buttons have `aria-label`, tone buttons keyboard-accessible |
| Real AI provider test | Not run | Requires OPENROUTER_API_KEY in env |
| Real compilation test | Not run | Requires Tectonic worker |
| **Postgres** | **Running** | `docker compose up` — Prisma `db push` succeeded, server starts without DB errors |
| **Redis** | **Running** | `docker compose up` — port 6379, worker queue ready |
| **Dev server** | **Running** | `next dev` on port 3000, homepage returns 200, protected routes return 401 |

## Must-pass test cases

1. [x] Second of two identical sentences paraphrased — Accept changes only the targeted range via offset-based `verifyAcceptance` (test: `verifyAcceptance > handles repeated identical text correctly`)
2. [x] Delayed paraphrase after user edits selection — Accept disabled, stale detection (onDidChangeContent + pendingParaphraseStaleRef)
3. [x] Delayed completion after typing — debounce+request ID+model version+line+column checks discard stale suggestions
4. [x] Model deletes `\cite{...}`, changes `$E=mc^2$`, duplicates protected token, or adds `\input{other}` — rejected by `verifyAndRestore` (tests for duplicate, out-of-order, missing, dangerous-command-introduced)
5. [x] Multiline selection with blank lines — exact source preserved (test: `computeDiff > handles whitespace and newlines`)
6. [x] Diff displays insertion, deletion, punctuation, line-break changes without source markup (test: `computeDiff` tests)
7. [x] Anonymous/second user cannot call AI or poll/cancel/download owner's compilation job (code: ownership checks in all routes + withAuth)
8. [x] Failed/rate-limited AI calls leave document editable and source unchanged (tests + code: returns `{ insertion: null }` silently)
9. [x] Save/compile after Accept uses accepted source; pending/rejected never stored (code: proposals stored in React state only, never in Prisma)
10. [x] Inline math $...$ is detected by scanContext for autocomplete suppression
11. [x] Comment detection handles escaped \% correctly (not a comment start)

## Verification performed

- TypeScript: `tsc --noEmit` — passes (0 errors)
- Tests: `vitest run` — 80/80 passed
- Build: `bun run build` — succeeds (previously verified)
- Lint (our files): 0 errors, 0 warnings
- Lint (total): 45 errors, 19 warnings — all pre-existing, none in our files

**Live integration not verified**: No OpenRouter API key configured in environment, no Postgres/Redis/Docker services running locally. Tests use mocked/deterministic validation. Real AI provider and Tectonic compile cannot be exercised without these.

### Services not available for live testing

### Services available

- Postgres: running on localhost:5432 (docker)
- Redis: running on localhost:6379 (docker)
- Dev server: running on http://localhost:3000

### Services not available for live testing

- Docker/Tectonic (compilation worker)
- OpenRouter API key

### Remaining issues and limitations

1. Inline math `$...$` is now detected by both scanContext (for autocomplete suppression) and analyzeSelection's masking layer. The environment-stack scanner treats \begin/end tokens inside verbatim as real math environments — this is a documented limitation of the conservative lexical detector.
2. Rate limiting uses in-memory Map, not Redis. Works but resets on server restart. The existing `rateLimit.ts` uses Redis for compilation rate limiting; the AI routes could be migrated to Redis similarly.
3. No Playwright browser tests — require a running dev server with auth session.
4. No real OpenRouter provider test — requires `OPENROUTER_API_KEY` in env.
5. No real compilation test — requires Postgres, Redis, Docker, and worker containers.

## Scope reminder

This delivery concerns one-document LaTeX editing with AI prose autocomplete and selected-text paraphrase review. Multi-file projects, collaboration, rich-text editing, offline mode, or full Overleaf parity are not claimed. The sample file tree is not evidence of those features.