# Runes AI vs Arc UI reference — same-size side-by-side comparisons

Every file in this folder is a two-panel comparison: **left = Arc UI public demo**, **right =
Runes AI on this branch**. Both panels are crops of full screenshots taken at the **same viewport
size**, with the **same crop rule** (full viewport width, `y = 10`, 760 px tall at 1440x900 and
704 px tall at 390x844), so nothing is cropped horizontally on either side and the two panels of a
pair are pixel-for-pixel the same dimensions.

| Viewport tag | Size | Used for |
| --- | --- | --- |
| desktop | 1440x900 | `compare-01` … `compare-20`, `compare-25` |
| narrow | 390x844 | `compare-21` … `compare-24` |

## How each side was captured

- **Arc panels** (`arc-*-desktop`, `arc-*-narrow`): the public previews
  `uiarc.dev/components/blocks/ai-inline-edit` and `uiarc.dev/components/ghost-text`, driven with
  headless Chromium (selection set programmatically, then real clicks/keys), captured 2026-11-01.
  Visual/behavior reference only — no Pro source, markup or assets were taken. The tight per-state
  crops stay in [`../ai-inline-edit-reference/`](../ai-inline-edit-reference/README.md) with the
  observed-vs-described labels.
- **Runes panels** (`runes-*-desktop`, `runes-*-narrow`): a local `next dev` server on this branch,
  driven with Playwright + headless Chromium through the real Monaco editor (pointer clicks, real
  keys, `Ctrl+S`), authenticated with the repo's `DEV_AUTH_BYPASS` dev session.
- **No live AI provider key exists in this environment.** The Runes answers come from the
  development-only, env-gated stub (`src/lib/ai-dev-stub.ts`, `AI_DEV_STUB=1`), which replaces only
  the provider *reply*; auth, writable-document checks, quota, the single active slot,
  protected-token masking/restore, size caps and the 15 s timeout still run on it. Text is therefore
  deterministic (`Overall, …`, filler removal, contraction expansion) and **no pair proves the
  behaviour of a real model**.
- Runes frames use **Code view** (source only). Markdown pairs use a `.md` document; the ghost-text
  desktop frames use a `.tex` document, and `../ai-inline-edit-runes/ghost/10-markdown-accepted.png`
  shows the same flow in Markdown.

## Pairs

| File | State compared |
| --- | --- |
| `compare-01-inline-idle.png` | Idle editor + shortcut hint |
| `compare-02-inline-selection-bubble.png` | Eligible selection with the Edit bubble |
| `compare-03-inline-prompt-quick-actions.png` | Prompt with quick actions |
| `compare-04-inline-typed-instruction.png` | Bounded free instruction typed |
| `compare-05-inline-streaming-stop.png` | Streaming with Stop |
| `compare-06-inline-review-open.png` | Word-diff review, nothing decided yet |
| `compare-07-inline-review-focused-change.png` | One change focused after `Tab` |
| `compare-08-inline-accepted-change.png` | Per-change accept |
| `compare-09-inline-rejected-change.png` | Per-change reject |
| `compare-10-inline-applied-receipt.png` | Applied receipt with Undo |
| `compare-11-inline-ghost-text.png` | Ghost suggestion in the document |
| `compare-12-inline-ghost-accepted.png` | Ghost accepted with Tab |
| `compare-13-ghost-idle.png` | Idle status chip |
| `compare-14-ghost-thinking.png` | Thinking (~450 ms debounce) |
| `compare-15-ghost-partial-stream.png` | Mid-stream frame |
| `compare-16-ghost-tab-ready.png` | Ready with the Tab hint |
| `compare-17-ghost-word-accept.png` | Word accept, remainder kept |
| `compare-18-ghost-fully-accepted.png` | Whole suggestion accepted |
| `compare-19-ghost-dismissed.png` | Escape dismissed, source unchanged |
| `compare-20-ghost-no-suggestion.png` | No suggestion + Retry |
| `compare-21-narrow-inline-idle.png` | Narrow (390x844) idle editor |
| `compare-22-narrow-inline-prompt.png` | Narrow prompt after `Ctrl+K` |
| `compare-23-narrow-inline-review.png` | Narrow review card |
| `compare-24-narrow-ghost-ready.png` | Narrow ghost + chip after a resize |
| `compare-25-inline-refusal-runes-only.png` | Ineligible-trigger refusal — **no reference frame exists** (the public demo exposes no error/unavailable state), the left panel says so |

## Differences table

"Unavoidable" means a Monaco/Runes-chrome constraint the plan already allows
(`docs/ai-inline-edit-plan.md` §User flow 4, §Ghost text 5); "By plan" means a deliberate product
decision; "Polish" means it could be aligned further.

| # | State | Arc reference | Runes AI | Type |
| --- | --- | --- | --- | --- |
| 1 | Idle | Hint sits in the document card footer next to a word count | Same wording, in the editor toolbar row (a code editor has no card footer) | Unavoidable |
| 2 | Edit bubble | Dark pill `Edit ⌘K` above the selection | Light pill `Edit Ctrl K` beside the selection, using Runes design tokens; also reachable by `Ctrl/Cmd+K` and touch | Polish (theme) |
| 3 | Prompt | Instruction input **above** a 5-row listbox (Shorten, Make clearer, Friendlier tone, More formal, Fix grammar); hint "↑ ↓ to choose, ↵ to run" | Four quick-action chips (**by plan**: Shorter, Clearer, Formal, Fix grammar) **above** the instruction field, plus a selection preview, a `0/500` counter and an explicit `Rewrite` button | By plan |
| 4 | Streaming | Pending words shimmer **inside** the paragraph; bar "Editing … Stop esc" | Anchored card: "Editing", `Stop`, `esc`, skeleton progress and the word diff revealed word by word; the model text is never touched | Unavoidable (no provisional text in the Monaco model) |
| 5 | Review | In-place `del`/`ins` marks in the paragraph; floating bar "2 of 2 changes / Reject all / Accept all Ctrl ↵" | Anchored `REVIEW CHANGES` card with the same marks, `del` struck through and `ins` underlined **plus text labels**, a per-change decision superscript, and an explicit `Apply` step | Unavoidable (Monaco) + by plan (explicit Apply, labels) |
| 6 | Review counter | Counts changes present ("2 of 2 changes") | Counts **decisions made** ("0 of 2 changes"), and `Apply` stays disabled with the reason "2 of 2 changes still need a decision" | By plan |
| 7 | Focused change | No focus ring could be captured; the demo needs genuine focus | `ring-1 ring-action` + `aria-current="true"` on the focused change after `Tab` | Polish (reference limitation) |
| 8 | Per-change accept/reject | Exposes buttons named "Accept change" / "Reject change" per hunk, but synthetic clicks and keys left the bar text and the `del`/`ins` set unchanged — the reference frames stay the review frame | `Enter` accepts and `Backspace` rejects the focused change visibly (`ACCEPTED` / `REJECTED` superscript, counter advances); `Ctrl/Cmd+Enter` accepts the rest | By plan (reference not observable) |
| 9 | Applied receipt | Bar "Applied 2 of 2 / Undo" | Bar "Applied 2 of 2 / Undo / Close" (Close mirrors `Esc`); the applied edit is one Monaco undo step | Polish |
| 10 | Ghost text | Muted italic continuation inside the demo's textarea mirror | Monaco native `ghost-text-decoration` (no mirrored textarea) | Unavoidable |
| 11 | Ghost chip | Bottom-right of the card: model name → "Accepted" / "Couldn't get a suggestion" + Retry | Top-right of the editor: the **real configured model name** when one is set, otherwise the fallback label `AI complete` (`src/lib/ghost-text.ts:112`) → `Thinking…` → `Tab to accept` + `Accept` → `No suggestion` + `Retry`, mirrored to an `aria-live` polite region. No key exists in this environment, so the captured idle frames show `AI complete` rather than a model name | Unavoidable (Monaco chrome) + by plan (real model name, announcements) |
| 12 | Partial stream | Suggestion grows phrase by phrase (observed via DOM: first phrase ~900 ms, all phrases by ~1.1 s) | Complete words now appear as a Monaco injected-text decoration during the stream; the native inline completion replaces the preview at `done`. The original comparison pairs predate this fix; see `../ai-inline-edit-runes/ghost/ghost-partial-stream-followup.png`. | Implementation difference |
| 13 | Word accept | `Ctrl →` commits one word, remainder stays ghosted | `Ctrl/Cmd+Right` (and `Alt+Right` where free) commits one word, remainder re-offered without refetching; parity | — |
| 14 | Dismiss | Escape removes the ghost, text unchanged | Escape removes the ghost and the run was verified **zero-byte** by reading the saved file back from the server | Parity + extra proof |
| 15 | No suggestion | "Couldn't get a suggestion" + Replay/Retry | "No suggestion" + `Retry` chip, typing is never blocked | Polish (wording) |
| 16 | Narrow layout | Card chip row wraps under the text | Cards are width-capped (`min(24rem, 100vw-2rem)`) and every control gains a `[@media(pointer:coarse)]:min-h-11` touch target | Polish |
| 17 | Dark mode | Site "Switch to dark mode" gives a dark variant of every demo | Runes has no theme system (light only), so **no dark pairs exist** here | Unavoidable (app-wide) |
| 18 | Error / unavailable | Not exposed by the public demo (described only in the Pro API reference) | Honest refusal card, e.g. "Caret is not on a prose line", with zero source change | By plan |

## Honest gaps in this set

- Panels 7 and 8: what Arc *does* on per-change accept/reject is **not** shown — the public demo's
  per-change controls did not respond to synthetic clicks or keys, so the left panel of those two
  pairs is the still-open review. The Runes side is the only side that demonstrates the behavior.
- Panel 15 is labelled "mid-stream" but the Runes frame shows the `Thinking…` chip with no partial
  words (row 12 above); the Arc frame shows one phrase. That asymmetry is the point of the pair.
- The Arc frames in these pairs come from the same scripted demos as the reference folder, i.e.
  simulated content ("Simulated, nothing is sent"); Runes frames come from the dev stub. Neither
  side shows a real model's output.
- Touch tap-to-accept is not shown: no touch device emulation frame was captured, only the
  `pointer:coarse` target sizing noted in row 16.
