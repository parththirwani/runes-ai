# AI inline edit for the Runes AI editor

Status: implementation handoff. The reference is the public [Arc UI AI inline edit preview](https://uiarc.dev/components/blocks/ai-inline-edit), inspected on 1 November 2026. Arc's source and install command require Pro access. Implement the behavior in Runes AI's existing editor; do not assume its private package or source is available.

## Goal

Let an editor select prose, press Ctrl/Cmd+K or tap an Edit action, enter an instruction or choose a quick action, and review the proposed replacement beside the source before applying it. Keep the existing Tab-accepted ghost text. AI must never silently change a file.

The target is Markdown and LaTeX source in Monaco, not Arc's plain-paragraph `contenteditable`. Preserve Markdown syntax, LaTeX commands, the current workspace file model, save/autosave, PDF compilation, and the existing side panel for non-editing AI tasks.

## What the reference does

Arc's public demo and API description show a selection bubble, a Ctrl/Cmd+K prompt anchored below the selection, quick actions plus free instructions, streamed replacement text, an inline word diff, per-change and all-at-once review, undo, and short ghost text accepted with Tab. With no selection, Ctrl/Cmd+K targets the sentence around the caret. Escape closes or cancels the active state. The public usage example expects an `onRequestEdit` callback that returns a string or an async stream and an `onSuggest` callback for completion. Arc says its demo suggestions are scripted. These observations describe behavior; they do not give us the Pro implementation.

## Current Runes AI implementation

| Existing piece | Location | Use in this feature |
| --- | --- | --- |
| Monaco editor, Markdown and LaTeX language setup | `src/app/components/editor/MonacoEditorWrapper.tsx` | Add editor-scoped command, selection position, and decoration hooks. Keep the Monaco model as the only editable source. |
| Selection checks, completion, request lifecycle, and proposal application | `src/app/components/editor/DocumentEditor.tsx` | Extract the inline edit controller from this component where useful. Reuse its document, model-version, range, abort, and undo checks. |
| Paraphrase API | `src/app/api/ai/paraphrase/route.ts` | Reuse authentication, writable-document check, quota, concurrency, format detection, bounded context, protected-token validation, and provider timeout. Its current schema accepts only `Clearer`, `Shorter`, and `Formal`. |
| Proposal diff and exact-range checks | `src/lib/proposal-engine.ts`, `src/app/components/editor/DiffReview.tsx` | Keep exact acceptance checks and one undoable Monaco edit. Extend review to show the diff at the selection. |
| Ghost text completion | `src/app/api/ai/complete/route.ts`, `DocumentEditor.tsx` | Keep current prose suppression, 400 ms debounce, cancellation, stale checks, and Tab behavior. Hide completion while the inline prompt or review is open. |

The current paraphrase UI sits in the editor toolbar and side panel. Its response is one JSON replacement, with a diff shown below Monaco. It does not accept free instructions or stream. The plan below moves the interaction to the selection while keeping these working paths until the inline flow is verified.

## User flow and decisions

1. When a writable prose selection is eligible, show a small Edit button near it. Ctrl/Cmd+K opens the same prompt. Do not capture that shortcut outside the editor. A touch selection gets the same Edit button. Read-only users see neither action.
2. If there is no selection, Ctrl/Cmd+K selects the sentence containing the caret only when a deterministic Markdown or LaTeX prose scanner can identify one eligible range. If it cannot, show a short reason and leave the source unchanged. Never send a whole file or an arbitrary line as fallback. Limit one edit to one prose block and the existing selection size cap. Reject a cross-block or protected selection with an explanation.
3. The prompt offers `Shorter`, `Clearer`, `Formal`, and `Fix grammar`, plus a free instruction field. A quick action sends a server-defined instruction ID; free text has a length limit and is validated server-side. The user's instruction must not override the rules that preserve syntax and protected tokens.
4. While the response arrives, show a Stop control and a progress status near the selection. Keep original source bytes in Monaco. Display streamed words as a preview decoration or overlay, with removed and added words marked by strike-through/underline and labels. If the chosen Monaco rendering approach cannot maintain caret and selection stability, show the diff in an anchored review card instead. Do not insert provisional AI text into the model.
5. On completion, offer Accept and Reject, with clear keyboard and touch controls. Accept applies the exact replacement range as one Monaco undo step only after rechecking document ID, workspace path/model URI, model version, original bytes, and proposal state. Reject, Stop, Escape, navigation, or a stale result leaves source untouched. An accepted edit uses the normal dirty/save path and marks the PDF stale.
6. Keep one proposal active per editor. Starting a new edit, changing files, toggling read-only state, or unmounting cancels the request and clears its decorations. Undo/redo remains Monaco's normal behavior after Accept. The old toolbar and side-panel entry points may open the new prompt with the current selection; remove duplicate review UI only after tests cover both entry paths.

### Per-change review

Arc offers per-change decisions. For the first Runes release, make the whole selected range the review unit. Add per-change acceptance only after a separate pure hunk builder can map each accepted/rejected word change back to exact source offsets, preserve protected Markdown/LaTeX spans, and commit the final combined text as one verified Monaco edit. Do not present per-change controls that merely accept the entire proposal. This is a follow-up milestone, not a release blocker for the selection prompt.

## Implementation sequence

1. **Selection and state.** Add an editor-scoped state machine (`idle`, `prompt`, `requesting`, `review`, `error`) and pure selection helpers. Capture document ID, active workspace path, Monaco model URI/version, offsets, original bytes, and format. Position the bubble/card from Monaco selection coordinates and clamp it inside the editor on resize or scroll. Restore focus and selection when dismissing the prompt. Add a non-hover trigger for touch and keyboard users.
2. **Request contract.** Extend the paraphrase route or add `POST /api/ai/inline-edit` with a typed discriminated request for quick action ID or bounded free instruction. The server derives format from the writable document. Reuse the existing Markdown and LaTeX selection analyzers and response validators. Return only replacement text, a no-op, or a safe error. Keep quotas, one active AI slot per user, 15-second provider timeout, 10,000-character selection cap, and response-size checks. Never log source, instruction, or raw provider output.
3. **Streaming.** Add an optional streaming response mode after the non-streaming contract works. Frame replacement deltas with an explicit protocol, terminal success/error event, maximum cumulative bytes, and abort propagation to the provider. Validate the final assembled replacement before enabling Accept. If the provider cannot safely stream under current validation, buffer server-side and return a single replacement; the UI must still show requesting and review states. Stopping a stream discards the partial suggestion in Runes AI. This differs from Arc's partial-review behavior and avoids applying unvalidated text.
4. **Anchored review.** Reuse `computeDiff` for word-level tokens and add an accessible review card anchored to the selection. Use Monaco decorations or view zones only if they stay aligned through scrolling and wrapping. Do not render a second editable document. Announce request, completion, failure, and stale states. Use strike-through and underline plus text labels, not color alone. Respect reduced motion and narrow viewports.
5. **Completion and existing UI.** Suppress Monaco ghost text during prompt/request/review. Preserve Tab acceptance when the inline editor is closed. Resolve shortcut precedence with Monaco's command actions and existing app shortcuts. Route toolbar and side-panel paraphrase controls through the new controller, then remove only redundant controls and their dead state.
6. **Verification and release.** Add focused pure tests, route tests, and a browser interaction test. Run all repository quality gates. Open a `feat/` PR to `dev`, get review, and verify the feature in `dev` before a later release PR to `main`.

## Acceptance checks

- Markdown and LaTeX prose selections can open the prompt by keyboard, pointer, and touch. Read-only users cannot request edits. Ctrl/Cmd+K outside Monaco keeps the app's normal behavior.
- Quick actions and a free instruction produce a valid replacement. Empty/oversized instructions, protected or cross-block selections, missing provider, rate limit, concurrent request, timeout, and malformed AI output show an error without changing source.
- Request and review states remain anchored as the editor scrolls or resizes. Escape, Stop, Reject, file switch, document switch, typing during a request, and unmount cancel or invalidate the suggestion. Late responses never appear in another file.
- Accept applies exactly one undoable edit to the active file. Reject changes zero bytes. A stale proposal cannot apply after any model change, even if the same original text appears elsewhere. Save/autosave and PDF staleness still work.
- Markdown links, image URLs, inline code, math, emphasis, front matter, and structure remain protected. LaTeX commands, citations, references, math, and environment delimiters remain protected. Provider instructions cannot bypass these checks.
- Ghost text still appears only in eligible prose, Tab accepts it once, and it does not conflict with prompt/review keyboard actions. The prompt and review expose visible focus and accessible names; errors are announced.
- Tests cover the state machine, selection bounds, stale model/path checks, API authorization and validation, aborted requests, diff rendering, and keyboard/touch interactions. Existing AI, editor, save, and access tests remain green.

## Quality gate and handoff

Before the implementation PR, run `./node_modules/.bin/tsc --noEmit`, `bun run test`, `./node_modules/.bin/eslint .`, and `bun run build`. This feature changes the writable-document access path, so run the Postgres-backed integration suite with `docker compose -f docker/docker-compose.yml up -d` and `bun run test:integration`. Record command results in the implementation PR.

The agent implementing this should branch from current `dev`, keep the change scoped to inline editing, and open a PR into `dev`. The plan PR contains no runtime changes. Arc UI remains a visual and behavior reference; the implementation should use Runes AI code and its existing dependencies.
