# Implementation plan for the overnight agent

Read `requirements.md` first. Deliver `deliverables.md` as a checked, evidence-backed handoff. Work in the existing Next.js/React/Prisma app and preserve the current document and PDF flow. Make actual code changes and tests; these files alone do not complete the task.

## 0. Establish the baseline

1. Read `package.json`, the editor components, document routes, AI route, Prisma schema, and worker/queue code. Check `git status` before editing and preserve any user changes. Search for repo or parent `AGENTS.md` instructions.
2. Record the environment prerequisites in the handoff: Postgres, Redis, Google OAuth, OpenRouter, Docker/Tectonic, and the separate worker. Inspect `.env.example`; do not print secrets.
3. Run `tsc --noEmit` and `eslint .` before edits. The brief's observed baseline was a passing TypeScript check and 46 lint errors plus 22 warnings. Do not hide existing failures by weakening lint rules. Track which failures your changes add or fix.
4. Start the app if the local environment allows it. Record whether signing in, opening a document, saving, compiling, and viewing a PDF work before the editor changes. If credentials or services are absent, use component/API tests with mocks and state that live integration was unavailable.

## 1. Replace the textarea with a real LaTeX source editor

1. Install a stable, compatible `monaco-editor` and `@monaco-editor/react` pair using the repo's chosen package manager. This repo has both `bun.lock` and `package-lock.json`; choose one authoritative workflow for this change and avoid unnecessary lockfile churn. Record versions actually installed.
2. Replace `MonacoEditorWrapper.tsx` with a client-only Monaco editor. With Next.js, ensure browser-only Monaco setup runs after mount, not during server rendering. Keep `DocumentEditor`'s source value as the app's source of truth and avoid model resets on every keystroke. Give each document a stable model URI, dispose editor/model/providers when appropriate, and retain selection/scroll during unrelated React renders.
3. Register a `latex` language if the selected Monaco package does not supply one. Add a conservative Monarch tokenizer for commands, comments, braces, math delimiters, and environments, plus bracket pairing and common command/environment snippets. Keep these local syntax suggestions separate from the AI prose provider. Verify theme contrast in the existing dark UI.
4. Expose a typed editor handle or callbacks to `DocumentEditor`: current model, selection, source version, focus, and an `applyAcceptedEdit` operation. Use Monaco's `executeEdits` with `pushUndoStop` before and after the replacement so one Ctrl/Cmd+Z reverses the full accepted proposal. Do not replace the whole source through React state when accepting a small edit.
5. Recheck save, autosave, compile, split view, PDF pane, title edit, and Ctrl/Cmd+S. Address any current save-state bugs revealed by tests. An editor change should mark the PDF stale until a successful compile.

## 2. Build the shared proposal engine before AI UI

Put range validation, stale checking, protected LaTeX handling, and diff preparation in small testable modules under `src/lib/` or `src/app/components/editor/`. Keep model calls and visual components separate from these pure rules.

1. Capture document ID, exact original selection, start/end offsets, Monaco version, and a unique proposal ID. Normalize line endings consistently for offsets; do not normalize the document silently. Monaco offsets and JavaScript string slicing must agree for the current model. Test Unicode and multiline ranges.
2. While a request is pending, listen for model edits. The simplest safe policy is to invalidate if the model version changes anywhere; this can be relaxed to tracked ranges only if tests prove it. At acceptance, also verify the selected range still equals `originalText`. Never use `String.replace` on the whole document because repeated text may replace the wrong occurrence.
3. Render the difference from `originalText` and `replacementText` using `diffWordsWithSpace` from `diff` or an equivalent reviewed library. Preserve every whitespace and newline token. Show deleted and added spans with labels/colors that remain understandable without color alone. If a diff computation fails or is too large, show a readable full original/proposed comparison.
4. Define a single transition table in code or tests: `idle -> requesting -> pending -> accepted/rejected/stale/error`. A second request cancels or supersedes the first. Document switch disposes the old proposal. Reject discards it. Accept performs a single edit, clears it, and lets ordinary editor state drive saving.
5. Avoid storing pending AI text in Prisma. It should not affect compilation until accepted. Do not use HTML injection for diff display.

## 3. Implement selection-safe paraphrasing

1. Add `POST /api/ai/paraphrase` or an equivalent focused route. Use `withAuth`, fetch the document with `userId` in the query, validate all fields with Zod, bound selection/context lengths, and enforce per-user limits in Redis. The endpoint returns candidate text only; it never updates `Document.content`.
2. Build a limited LaTeX-aware selection scanner. It should reject preamble, comments, math/verbatim environments, structural command names, unbalanced braces, and selections crossing unsupported boundaries. For mixed prose with citations, references, inline math, or other protected fragments, replace those fragments with unique opaque placeholders before the model call. Store the original mapping server-side for that request. Require the returned placeholder sequence to match exactly once and in order, then restore the original bytes. If this cannot be guaranteed, return an unsupported-selection error instead of risking LaTeX corruption.
3. Prompt the model to return one paraphrased replacement of the selected prose for the requested tone. Do not ask it to choose lines or rewrite the full document. Give it only bounded context and protected placeholders. Use a model/endpoint that supports the requested response format and validate the returned shape and length at runtime; OpenRouter documents that enforcement varies across providers. Reject leading explanations, fenced code blocks, new LaTeX commands, missing placeholders, empty content, and unexpectedly large changes.
4. In the editor, offer Paraphrase only when selection conditions allow it. Keep the selected range highlighted while requesting and reviewing. Show progress, cancellation, useful errors, and the candidate diff with Accept/Reject. Maintain focus or provide an explicit return-to-editor control. "Regenerate" captures a fresh snapshot.
5. For an exact no-op, clear the request and show "No change suggested". Do not mark the document dirty. For a stale result, show why Accept is disabled. Accept only after the exact range comparison and protected-token checks pass, then execute one undoable edit.

### Paraphrase edge cases to implement and test

- The same sentence appears twice; accepting the second selection changes only the second occurrence.
- Selection starts or ends mid-word; use the exact range or explain that the selection must cover complete prose. Do not silently widen it.
- Multiple lines, blank lines, Unicode characters, escaped LaTeX characters, and line-ending differences do not corrupt offsets.
- `\cite{key}`, `\ref{label}`, `$E=mc^2$`, `\emph{...}`, `\section{...}`, and environment delimiters stay intact or are rejected clearly. Include a response that drops or duplicates a placeholder and prove it cannot be accepted.
- User edits the selected range, saves, or switches document before AI returns. The old response never lands.

## 4. Implement AI prose autocomplete

1. Add `POST /api/ai/complete` with the same auth, ownership, Zod, quota, error, and output-size rules. Request contains bounded prefix/suffix from the live model and a client request ID. The server returns only an insertion string. Prompt for a brief prose continuation that fits before the suffix and does not rewrite existing text or output Markdown fences.
2. Register Monaco's `registerInlineCompletionsProvider` for `latex`. Dispose the provider on unmount. On each eligible invocation, debounce about 350 to 500 ms, abort a prior fetch, pass Monaco's cancellation signal through to the request, and use a monotonically increasing request ID. Before returning a suggestion, compare the document ID, model version, cursor position, and relevant prefix/suffix with the captured values. Discard any mismatch.
3. Write a conservative context detector. Suppress AI completion in preamble, math, comments, verbatim-like environments, selection, command names, and pending diff review. Limit concurrency to one request per editor. Avoid asking on each character when there is no prose context. Local LaTeX snippets may still appear in command context.
4. Return an insertion-only inline completion at the current caret. Confirm the Monaco API's range semantics for the installed version; do not supply a replacement range that consumes source. Configure Tab to accept the visible inline suggestion and Escape to dismiss. Make sure Tab still indents or accepts local snippets normally when no AI suggestion is visible.
5. Keep errors quiet and bounded. Show a one-time status or tooltip for 429/provider unavailable; never open a modal on every keystroke. Provide an obvious AI-autocomplete on/off preference within the editor session. Do not persist it unless doing so is simple and tested.

### Autocomplete edge cases to implement and test

- A slow response arrives after the user types more, moves the caret, switches documents, or triggers a second request. It must never appear or insert.
- Escape leaves source unchanged; Tab accepts exactly once; undo removes the insertion.
- No AI network call occurs inside `\begin{equation}`, `$...$`, a `%` comment, preamble, or `verbatim` region.
- Provider returns a full sentence that repeats the current prefix or contains a LaTeX document wrapper. Reject it rather than duplicating text.
- Network failure, 429, and missing `OPENROUTER_API_KEY` do not block typing, saving, or compiling.

## 5. Authorization and API cleanup

1. Fix the existing `/api/chat` endpoint before linking it to the editor, or leave it unused and document that choice. It currently fetches a document by ID without an ownership check. If it remains exposed, secure it even if the new features use different routes.
2. Associate compilation jobs with their submitting user for the lifetime of the job and result. Check ownership in `/api/job/[jobId]` GET/DELETE and `/api/pdf/[jobId]` GET. A signed-in user who guesses another job ID must receive a nonrevealing denial. Test this with two users. Keep the current producer/worker contract compatible.
3. Do not rely on client-only limits. Add tests for anonymous, wrong-owner, invalid schema, oversized payload, quota exceeded, provider failure, and successful owner requests. Avoid logging selected text or the model's raw response in production.
4. Inspect the worker's Docker command and resource limits before marking the app production-ready. The overnight task only requires the existing compile flow to regress cleanly; any broader compiler hardening should be reported as remaining work if not completed.

## 6. Testing strategy

Choose a lightweight test runner suitable for the existing TypeScript/Next.js setup, such as Vitest for pure and component tests plus Playwright for browser flows. Pin versions compatible with this repo. Do not call the real model in automated tests; inject or mock a deterministic provider. A real-provider smoke test is separate.

### Unit tests

- LaTeX context scanner: eligible prose, preamble, comments, math, verbatim, structural commands, mixed prose with protected tokens, escaped percent signs, multiline selection.
- Placeholder masking/restore: exact bytes, ordered uniqueness, deletion/duplication rejection, no new command leakage.
- Proposal engine: exact-range apply, repeated text, stale version/range, accept/reject, no-op, Unicode, multiline, single undo transaction where editor integration is involved.
- Diff token rendering: additions, deletions, punctuation, whitespace, newlines, empty side, and safe text rendering.
- Completion filter: insertion-only, size/format checks, repeated-prefix rejection, stale request rejection.

### API tests

- Mock auth, Prisma, Redis rate limit, and OpenRouter. Assert ownership and request validation for each endpoint. Verify no database write occurs during suggestion generation.
- Test malformed/empty/oversized provider responses, missing config, timeout, and 429. Confirm errors do not include source text or secrets.
- Test wrong-owner job status, cancellation, and PDF retrieval, including after the worker marks a job complete.

### Browser tests

- Use a test account/fixture document and a stubbed AI response. Open a document, type, observe a ghost suggestion, accept with Tab, undo, and save/reload.
- Select the second of two identical paragraphs, request paraphrase, see a readable diff, Reject, and verify the whole source is byte-identical. Repeat, Accept, undo, redo, save/reload, and confirm only the second paragraph changed.
- Start paraphrase, edit the selection before the response returns, then deliver the mocked response. Assert Accept is unavailable and source is unchanged.
- Navigate away during an in-flight completion or paraphrase. No result appears in the next document.
- Compile after accepting a change, poll the job, view the PDF, and download it when the full local service stack is available. Otherwise record the exact missing service and cover the UI with a mocked compile route.
- Check keyboard access, focus order, visible labels, and dark-theme diff contrast. Include a narrow viewport smoke check so controls remain reachable.

### Verification commands and interpretation

Run the package-manager equivalent of `tsc --noEmit`, targeted new tests, full test suite, `eslint .`, and `next build`. Report the exit code and meaningful failures of each. Existing lint errors are not permission to add more. If `next build` fails solely because external fonts or services are unavailable, record that exact cause. Do not describe an unrun command as passing. Stop repeated optional tests after the critical paths are verified.

## 7. Review before handoff

1. Read the final diff for accidental changes to auth, save, compile, or model configuration. Confirm no keys, generated files, temp PDFs, or test credentials were committed.
2. Review the UI in the browser with the full workflow, including empty/error/stale states. Check that proposed text never becomes source before Accept and that both Accept and Reject remain visible and keyboard reachable.
3. Review the access boundary with two users. Attempt cross-user document AI calls and job/PDF access. Check logs and API responses for leaked source text.
4. Re-run the key automated checks after the final code change. Compare lint with the baseline. Inspect the changed lockfile and dependency list.
5. Fill `deliverables.md` with actual evidence, commands, limitations, and any remaining work. If a requirement cannot be completed, label it incomplete and explain the concrete blocker. Do not mark a feature done based on UI appearance alone.

## Research behind the plan

- Monaco documents [inline completions](https://microsoft.github.io/monaco-editor/typedoc/functions/editor_editor_api.languages.registerInlineCompletionsProvider.html), [selection and undoable `executeEdits`](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html), and [model range/offset conversion](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ITextModel.html). The [React wrapper](https://github.com/suren-atoyan/monaco-react) explains its browser-only use under Next.js.
- The [jsdiff API](https://github.com/kpdecker/jsdiff) provides `diffWordsWithSpace` for readable source comparisons without changing the source.
- [OpenRouter structured output](https://openrouter.ai/docs/guides/features/structured-outputs) documents provider-specific enforcement, which is why runtime validation remains required.
- [Overleaf's editor guide](https://docs.overleaf.com/getting-started/how-do-i-use-overleaf/redesigned-overleaf-editor) and [track changes guide](https://docs.overleaf.com/collaborating/track-changes) informed the review interaction. This implementation is an AI-proposal review flow, not collaborative track changes.
