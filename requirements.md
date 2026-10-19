# AI LaTeX editor requirements

Status: implementation brief for an overnight coding agent. Last reviewed: 2026-10-20.

## Goal and scope

Build an Overleaf-like single-document writing loop on the existing Runes AI app: edit LaTeX source, save it, compile it, and inspect a PDF beside the source. Add three useful AI interactions to that loop:

1. Prose autocomplete appears as optional ghost text while the user writes.
2. The user selects prose and asks for a paraphrase.
3. The user sees a precise source diff and explicitly accepts or rejects each AI proposal.

"Overleaf-like" describes the editing workflow and review clarity, not full Overleaf parity. This project already has a dashboard, authentication, one source string per document, manual compilation, and a PDF pane. Preserve those working paths. This brief does not require real-time collaboration, rich-text editing, multi-file projects, bibliography management, SyncTeX, full track changes for human edits, or automatic compilation. Do not claim those features in the finished handoff.

## Starting point in this repository

- `src/app/components/editor/DocumentEditor.tsx` owns the source string, save/compile controls, and split view.
- `src/app/components/editor/MonacoEditorWrapper.tsx` is currently a `<textarea>`, despite its name. It needs a real editor engine to provide selections, inline suggestions, decorations, and undoable edits.
- `src/app/components/editor/FileTree.tsx` displays sample files. The database stores one source string in `Document.content`, so the sample tree is not a real project file system.
- `src/app/api/chat/route.ts` and `src/lib/openrouter.ts` return model-generated line-based edits but have no editor UI. The route does not authenticate or verify document ownership. Do not reuse it for the new flow without correcting that.
- `src/app/api/document/[slug]/route.ts` queues compilation; `worker/latex-compiler.ts` compiles with Docker and Tectonic. Compilation and PDF preview are part of regression testing, not a request to redesign the worker.
- `src/app/api/job/[jobId]/route.ts` and `src/app/api/pdf/[jobId]/route.ts` require login but do not verify job ownership. Close this access gap if those routes are touched or used by the completed flow.
- TypeScript passed `tsc --noEmit` at brief creation. ESLint reported 46 errors and 22 warnings, including old landing-page issues. Record the before/after state; do not silently claim a clean lint run.

## Required user journeys

### R1. Baseline editor

- A signed-in user opens a saved document and sees editable LaTeX source and the existing PDF preview. The source retains its value, cursor, selection, and scroll position during ordinary edits and review UI changes.
- Save, autosave, compile, download, title editing, and editor/split/preview modes still work. A pending AI proposal is never saved or compiled as accepted source.
- The editor has line numbers, LaTeX syntax highlighting, find, undo/redo, and keyboard selection. Add local LaTeX command/environment snippets where practical. The main requested autocomplete is AI prose continuation, not only LaTeX command completion.
- The app must state honestly when the PDF is older than the current source. Manual Recompile remains an explicit action.

### R2. AI prose autocomplete

- In ordinary prose inside `\begin{document}` ... `\end{document}`, after a short typing pause, offer at most one short continuation as ghost text at the caret. Default target: one phrase or sentence, at most about 200 characters. Show no suggestion for empty context.
- Trigger only at an empty selection. Suppress requests and suggestions in the preamble, comments, math mode/environments, verbatim-like environments, immediately inside a LaTeX command or argument that should be syntax-controlled, and while a diff proposal is pending. A conservative lexical detector is acceptable; when unsure, do not suggest.
- Tab accepts the visible suggestion through Monaco's edit/inline-completion behavior. Escape dismisses it. Typing, moving the caret, changing the document, switching documents, or a newer request makes an old response unusable. Dismissal must not alter source.
- Autocomplete uses unsaved editor context, not only the last database save. Send a bounded prefix and suffix around the caret. Never send credentials or unrelated documents. The request must include a document identifier and must be authorized for that user.
- Debounce requests, cancel superseded requests, and enforce a server-side per-user limit. An unavailable AI provider leaves normal editing fully functional and shows only a quiet failure state, not a blocking modal per keystroke.
- The response is plain insertion text only. Reject responses that repeat the existing prefix, contain a document wrapper or unsafe LaTeX control sequence, exceed the limit, or are stale. No completion may delete existing text.

### R3. Selected-text paraphrase

- A nonempty selection inside document prose exposes a clear "Paraphrase" action by toolbar or context action. The action remains keyboard reachable. The action is disabled with a helpful reason for empty or unsupported selections.
- Capture the exact selected text, document ID, model version, start/end offsets or Monaco range, and a bounded amount of neighboring prose at invocation. The selection may span multiple lines. Do not use model-supplied line numbers to decide where to edit.
- Offer a small number of useful tone choices, such as "Clearer", "Shorter", and "Formal". Default to "Clearer". This is one proposal per invocation; regeneration replaces the pending proposal only after the user chooses to regenerate.
- Preserve LaTeX structure. Protect commands, math spans, citations/references, labels, braces tied to commands, and environments by masking or by rejecting unsupported selections. A model response may change prose, but must not silently change protected tokens or add new LaTeX commands. Validate the returned tokens before displaying a proposal.
- The result is a replacement candidate, not a document mutation. A no-op result says "No change suggested" and creates no proposal. Provider errors, malformed output, and protected-token violations leave source unchanged.
- A user may continue editing while the request runs. If the selection's original text or its tracked range no longer matches, mark the response stale and require a new request. Never guess a nearby location based on matching text elsewhere.

### R4. Review, diff, accept, reject

- Show the original and proposed selected text with additions and deletions clearly distinguished. A compact word-level diff should preserve whitespace and line breaks; an expanded read-only side-by-side view is acceptable. Keep the source visible or one click away. Do not insert diff markup into the LaTeX source.
- Each proposal has explicit Accept and Reject controls, with accessible names and keyboard access. Reject removes the proposal and changes zero source bytes. Accept replaces exactly the captured selection with the validated candidate as one undoable editor operation, then clears the proposal. Undo restores the exact original source.
- Before accept, verify document identity and that the current range still contains the captured original text. If not, disable acceptance, label the proposal stale, and offer "Regenerate" or "Dismiss". Do not silently rebase, overwrite later user edits, or accept against another document.
- One paraphrase request produces one atomic proposal. Highlight word changes within it; partial word or hunk acceptance is outside this MVP. If the existing chat feature is later connected to review, represent every non-overlapping edit as a separate proposal with independent Accept/Reject and the same stale checks. Do not advertise per-hunk acceptance unless implemented.
- Source save and compile operate only on accepted edits. Rejected or stale proposals do not make the document dirty. Accepted edits enter the normal save/autosave path and mark the PDF out of date until compilation.

### R5. Authorization and reliability

- Authenticate all new AI endpoints, verify that the document belongs to the current user, validate request sizes and types with Zod, and keep the OpenRouter key server-side. Avoid exposing raw provider errors or document content in client errors or logs.
- For any reused chat, job status, cancellation, or PDF result endpoint, validate ownership before reading or changing another user's data. Store or derive job ownership so it survives until the result expires.
- Rate limiting must be enforced on the server. A client debounce is a cost and UX control, not an authorization or quota control. Bound request time, context size, output size, and simultaneous requests. Return useful 400/401/403/404/429/5xx responses.
- Render AI text as text, never HTML. Do not trust a model's JSON shape without runtime validation even when structured output is requested.

## Proposed data and interaction contract

Use one shared proposal type in client code. The exact names can change, but these facts must be represented:

```ts
type EditProposal = {
  id: string;
  documentId: string;
  source: 'paraphrase' | 'chat';
  baseModelVersion: number;
  range: { startOffset: number; endOffset: number };
  originalText: string;
  replacementText: string;
  explanation?: string;
  state: 'pending' | 'stale';
};
```

Offsets are zero-based and bound to the editor model. Use Monaco's range/offset conversion for display. The model version helps detect changes, but the final equality check on the exact range is mandatory. If changes elsewhere in the document shift an untracked offset, invalidate the proposal. A tracked Monaco decoration or equivalent may keep the range anchored, but must still verify the original text before acceptance. The proposal is ephemeral; it need not be stored in Prisma for this scope.

Suggested HTTP contracts:

```text
POST /api/ai/complete
  { documentId, prefix, suffix, requestId }
  -> { insertion }

POST /api/ai/paraphrase
  { documentId, selectedText, before, after, tone, requestId }
  -> { replacementText, explanation? }
```

The server validates ownership and input. The client owns selection location and stale detection. Do not accept ranges, document IDs, or model responses as proof that the caller may edit that document. No database mutation occurs in these endpoints. If the agent chooses a combined endpoint, keep these semantics and document the final contract.

## Acceptance criteria

1. On a saved document, typing prose can show ghost text. Tab inserts only the offered suffix once; Escape or a stale response inserts nothing.
2. Selecting prose and choosing Paraphrase displays a visible original/proposed diff. Before Accept, saved source and PDF input are unchanged.
3. Reject leaves the exact source unchanged. Accept changes only the selection, is undoable in one undo step, marks the document dirty, and survives save/reload.
4. Editing the selected range while a request is pending or a proposal is visible makes acceptance impossible until regeneration. Repeated identical text elsewhere is untouched.
5. LaTeX macros, math, citations, references, and environment delimiters remain unchanged in accepted paraphrases. Unsupported selections give a clear explanation.
6. The user can still compile the accepted source and download the resulting PDF when the local Postgres, Redis, Docker, and worker services are available.
7. Anonymous users and a different signed-in user cannot call AI for the document or retrieve/cancel its compilation results.
8. Automated tests cover the pure text/proposal rules and critical UI flows with a mocked AI provider. A manual smoke test with a real provider and a real compile is recorded separately, or its missing credentials/services are stated explicitly.

## Sources consulted

- [Overleaf editor layout and review areas](https://docs.overleaf.com/getting-started/how-do-i-use-overleaf/redesigned-overleaf-editor), [recompile behavior](https://docs.overleaf.com/getting-started/recompiling-your-project), and [track changes controls](https://docs.overleaf.com/collaborating/track-changes). These informed the workflow baseline; they do not imply this MVP has collaboration or Overleaf's full review mode.
- [Monaco inline completion provider](https://microsoft.github.io/monaco-editor/typedoc/functions/editor_editor_api.languages.registerInlineCompletionsProvider.html), [editor selection and undoable edits](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html), and [model range/offset APIs](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.ITextModel.html).
- [React Monaco integration and Next.js note](https://github.com/suren-atoyan/monaco-react), [jsdiff word and line diff APIs](https://github.com/kpdecker/jsdiff), and [OpenRouter structured output guidance](https://openrouter.ai/docs/guides/features/structured-outputs). Structured output still requires app-side validation.
