# Runes AI — inline edit states (same flow as the Arc reference set)

Captured with Playwright + headless Chromium against a local `next dev` server on this
branch, driven through the real Monaco editor (pointer selection, real clicks, real keys).
These are Runes screenshots; `../ai-inline-edit-reference/` holds the Arc demo screenshots
they were built against. Nothing here is a mock-up: every image is the product DOM after a
user action.

## Environment

- `npm run dev` on port 3055, `NODE_ENV=development`.
- Auth: repo `DEV_AUTH_BYPASS=1` dev session (`/api/dev-login`) — no real identity provider.
- Data: local PostgreSQL (apt `postgresql-14`) with the Prisma schema pushed.
- AI: **no live provider key exists here**, so the request was answered by the repo's
  development-only, env-gated stub (`src/lib/ai-dev-stub.ts`, `AI_DEV_STUB=1`). The stub only
  replaces the provider *reply*: authentication, writable-document checks, quota, the single
  active slot, protected-token masking/restore, size caps and the 15 s timeout all still run
  on the stubbed reply. `AI_DEV_STUB_DELAY_MS=220` paces the stubbed stream so the streaming
  and Stop states are observable. **No image in this folder proves behaviour of a real model.**
- Viewports: desktop **1440x900** (light theme; the editor is light-only today, so there is no
  dark variant to compare), narrow **390x844**.
- Element-crop images (bubble, cards, receipts) are cropped to the card; `-editor`, `-full`,
  `-idle` and the `anchor-`/`save-` images are full 1440x900 pages.

## Images, in flow order

| File | State | How it was produced |
| --- | --- | --- |
| `md-01-editor-idle.png` | Idle editor with the shortcut hint in the AI toolbar | Opened a Markdown document, no selection |
| `md-02b-bubble.png` | `Edit` bubble on an eligible selection | Real mouse drag across one prose sentence |
| `md-03-prompt.png` | Prompt card: four quick actions + bounded instruction, `esc` hint | Clicked the bubble |
| `stream-01-early.png`, `stream-02-partial.png` | Streaming: `Editing`, `Stop`, `esc`, word-by-word word diff, source untouched | Clicked `Clearer`; two frames ~0.5 s apart |
| `stream-03-stopped.png` | Stop discards the partial edit and explains why | Clicked `Stop` mid-stream; the model text was verified unchanged |
| `md-05-review.png` | Per-change review: `0 of 2 changes`, struck-through/underlined word diff, Apply blocked with the pending-decision reason | Waited for the terminal `done` event |
| `md-06-review-focused.png` | Focused change after `Tab` (roving focus, `aria-current`) | Pressed `Tab` inside the card |
| `md-07-review-accepted.png` | `Ctrl+Enter` accepted the rest | Pressed `Control+Enter` |
| `md-08-receipt.png` | Receipt `Applied 2 of 2` with `Undo` | Clicked `Apply` (one undoable Monaco edit) |
| `md-09-applied-editor.png` | Model after the accepted edit (protected `` `pytest` `` intact) | Same run |
| `md-10-after-undo.png` | `Undo` pressed from the receipt (the byte-exact round trip is asserted in `save-03-after-undo.png`) | Clicked `Undo` on the receipt |
| `md-11-ctrlk-prompt.png` | `Ctrl+K` with only a caret opens the prompt on the sentence at the caret | Clicked in a sentence, pressed `Control+K` |
| `md-12-prompt-typed.png` | Typed free instruction with the live `0/500` counter | Typed `make it warmer` |
| `md-12b-free-instruction-review.png` | Review produced from a free instruction | Pressed `Enter` in the instruction field |
| `md-12c-kept-original.png` | `Kept the original` — Reject all commits **zero bytes** | `Reject all` then `Keep original` |
| `md-13-refusal.png` | Honest refusal when the trigger is ineligible (`Caret is not on a prose line`) | Caret on a `# heading` line, then `Control+K` |
| `tex-01-review.png` | LaTeX document review (`Formal` quick action) | Same flow in a `.tex` document |
| `tex-02-receipt.png` | LaTeX receipt `Applied 1 of 1` with `\cite{}` untouched | Clicked `Apply` |
| `anchor-01-open.png` | Review anchored under the selection | Long (60 paragraph) document |
| `anchor-02-after-scroll.png` | Same card followed the anchor after a 300 px wheel scroll | Card box moved 50 px with the text |
| `anchor-03-after-resize.png` | Card re-placed and still clamped inside the editor after a viewport resize to 1100x620 | `setViewportSize` |
| `save-01-receipt-and-dirty.png` | Accepted edit leaves the file dirty (unsaved marker) | After `Apply`, before saving |
| `save-02-after-save.png` | Normal save path persisted the accepted text | `Ctrl+S`; verified by reading the file back over the API |
| `save-03-after-undo.png` | One undo step + save returns the exact original bytes | `Undo` then `Ctrl+S` |
| `mobile-01-ctrlk.png` | Narrow viewport 390x844 with the keyboard-triggered prompt | Clicked a sentence, `Control+K` |

## Known gaps (honest, for the next pass)

- `Thinking`-style provider latency and real model wording are **not** represented: the answers
  come from the dev stub, so the visible edit is deterministic
  (`Overall, …`, filler removal, contraction expansion) rather than intelligent.
- Touch tap-to-accept and a real mobile touch selection are not shown here; the bubble and cards
  carry `[@media(pointer:coarse)]:min-h-11` touch targets, but no touch-device capture exists yet.
- Side-by-side Runes-vs-Arc comparison pairs and the differences table are still to be produced
  from these files (plan §"Screenshot reference and visual match").
- The Markdown/preview split occupies the left half at 1440 px, so Runes frames are not pixel
  aligned with the Arc demo frames; see the pending differences table.
