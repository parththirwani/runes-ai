# Arc UI reference screenshots — AI inline edit & Ghost text

Captured on 2026-11-01 with headless Chromium (Playwright, Chrome headless shell 156) from the
public previews of

- https://uiarc.dev/components/blocks/ai-inline-edit (`inline-*.png`)
- https://uiarc.dev/components/ghost-text (`ghost-*.png`)

These are visual/behavior references only. The components are Pro; no source, markup, or assets
were copied.

## Viewports

| Tag | Size | Notes |
| --- | --- | --- |
| `desktop-light` | 1440x900 | site default (light) theme |
| `desktop-dark` | 1440x900 | after clicking the site "Switch to dark mode" (Appearance) button |
| `mobile-light` | 390x844 | narrow layout, light theme |

Crops are element screenshots of the live demo block (the inline document card, or the ghost text
PR card), so the same crop applies at every width.

## How each inline state was triggered

The demo is a real scriptable block ("Live block · sample data"). Selection was set
programmatically on paragraph 1, then the flow advanced by clicking/typing exactly like a user.

| File (suffix per tag) | State | Status |
| --- | --- | --- |
| `inline-idle-*` | Idle document, footer hint "Select text and press Ctrl K to edit with AI" | DIRECTLY OBSERVED |
| `inline-selection-bubble-*` | Selection with floating "Edit / Ctrl K" bubble | DIRECTLY OBSERVED |
| `inline-prompt-quick-actions-*` | Prompt card: input "Ask AI to edit the selection", quick-edit listbox (Shorten, Clearer, Formal, Fix grammar), `esc` kbd | DIRECTLY OBSERVED |
| `inline-typed-instruction-*` | Free instruction typed into the prompt input | DIRECTLY OBSERVED |
| `inline-streaming-stop-*` | Rewriting: anchored bar "Editing ... Stop esc", shimmering pending words in the paragraph | DIRECTLY OBSERVED |
| `inline-review-focused-*` | Review: strike-through deletions + underline insertions with text labels, bar "2 of 2 changes / Reject all / Accept all Ctrl ↵", footer hints "Tab through changes, ↵ accept, ⌫ reject" | DIRECTLY OBSERVED |
| `inline-review-tab-cycle-*` | After pressing Tab with caret in the edited paragraph | ONLY DESCRIBED - no visible per-change focus indicator was captured; automation could not reliably land focus on one change |
| `inline-accepted-change-*` / `inline-rejected-change-*` | Per-change Enter accept / Backspace reject | ONLY DESCRIBED (footer hints show them). One manual attempt ended the whole review with the "Kept the original" receipt (that rejection receipt was observed once); steady captures show the still-open review |
| `inline-applied-receipt-*` | Ctrl+Enter "accepts the rest" -> bar becomes "Applied 2 of 2 / Undo" | DIRECTLY OBSERVED |
| `inline-accept-all-applied-desktop-*` | Clicking "Accept all" -> "Applied 2 of 2 / Undo", replacement text merged into the paragraph | DIRECTLY OBSERVED |
| `inline-ghost-text-desktop-*` | Ghost continuation after "Next week we will" with hint "Tab to accept, esc to dismiss" (applied receipt also visible) | DIRECTLY OBSERVED |
| `inline-ghost-accepted-desktop-*` | Ghost committed with Tab | DIRECTLY OBSERVED |
| (error/unavailable state on the inline block) | | NOT EXPOSED by the public demo - described only in the API reference |

## How each ghost text state was triggered

Public demo: a PR-description textarea, header note "Simulated, nothing is sent", a "Replay"
button and a model chip that shows the demo's model label ("Claude Haiku 5.5"). Caret was moved
to the end of the preset sentence and typing was triggered by Backspace+space; waits follow the
documented ~450 ms debounce.

| File (suffix per tag) | State | Status |
| --- | --- | --- |
| `ghost-idle-*` | Idle card, chip shows model name | DIRECTLY OBSERVED |
| `ghost-thinking-*` | ~180 ms after typing stopped | ONLY DESCRIBED - a distinct "Thinking" chip label was not captured in any frame; the chip kept the model name at the sampled moments |
| `ghost-partial-stream-*` | Suggestion arriving (~1 s after typing stops) | DIRECTLY OBSERVED |
| `ghost-tab-ready-*` | Full muted suggestion + chip row "Ctrl -> word / Esc dismiss / Tab to accept" | DIRECTLY OBSERVED |
| `ghost-word-accept-remainder-*` | After Ctrl+Right: first words committed, remainder still ghosted | DIRECTLY OBSERVED |
| `ghost-fully-accepted-*` | After Tab: full text committed, chip "Accepted" | DIRECTLY OBSERVED |
| `ghost-dismissed-*` | Escape removes the ghost, text unchanged | DIRECTLY OBSERVED |
| `ghost-no-suggestion-retry-*` | Documented `timeout` trigger -> chip "No suggestion" with a Retry control | DIRECTLY OBSERVED |
| touch-specific tap-to-accept control | | ONLY DESCRIBED - the 390 px capture shows the same card with wrapped chip row; no separate touch affordance appeared |

## Caveats

- Headless Chromium on Linux: the demo chip shows `Ctrl` for word-accept; the docs describe
  Cmd/Ctrl+Right.
- The public demos are scripted ("sample data" / "nothing is sent"); timings for the streaming
  frames are approximate captures mid-animation.
- Mobile captures use the site's own responsive layout at 390x844; the demo card itself does not
  expose a separate touch mode.
