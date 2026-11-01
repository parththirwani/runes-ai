# Focused editor and inline edit plan

## Problem

The editor kept an AI toolbar visible even when there was no selection or AI result. It repeated Paraphrase, tone controls, the edit shortcut, the completion toggle, and a status chip. The top bar also exposed Share, Move, Download, Compile, and AI workspace at once. Opening Edit showed four presets, an instruction field, several hints, a counter, and a second submit button.

## Reference patterns

- [Notion writing and editing](https://www.notion.com/help/writing-and-editing-basics) reveals editing tools after selecting content and uses commands for less common actions.
- [Notion AI](https://www.notion.com/help/notion-ai-faqs) starts from a selection, then lets the writer accept or discard the result.
- [Linear editor](https://linear.app/docs/editor) keeps formatting in a selection toolbar or command menu rather than a permanent row.
- [Grammarly paragraph rewrites](https://support.grammarly.com/hc/en-us/articles/30916398193037-Introducing-paragraph-level-rewrites) places rewrite actions beside the selected paragraph.

These are interaction references. Runes keeps its own visual style, Monaco editor, and review rules.

## Changes

1. Keep the title, view control, Compile, and one More menu in the document bar. Put Share, Move, Save draft, Download source, Insert image, and Writing tools in More.
2. Remove the persistent AI toolbar. Show a slim status row only during an AI request, suggestion, error, or image upload. Keep autocomplete preferences in Writing tools.
3. Keep the selection bubble and Ctrl/Cmd+K. Open a compact edit card with one focused instruction field, a send control, Clearer and Shorter, and a More menu for Formal and Fix grammar. Show the character count only near the limit.
4. Keep per-change review, undo, access checks, protected syntax checks, and one undoable Apply. Make the review card quieter by hiding per-change controls until a change is focused and removing the always-visible shortcut legend.
5. Close Writing tools when an inline edit opens. Escape closes the tools panel.

## Verification

- An idle editor has no AI toolbar, while thinking, ready, retry, and error states still have visible feedback.
- All document actions and four quick edits remain reachable by pointer and keyboard.
- The edit prompt, stream, review, Apply, and undo still work for Markdown and LaTeX.
- At 1440×900 and 390×844, the card stays inside the editor and its controls remain usable.
- TypeScript, unit tests, ESLint, build, and database integration tests pass.

Browser checks use the development AI stub. In Markdown, a free instruction reached review; Accept all, Apply, and Undo restored the exact original bytes. In LaTeX, Clearer reached review and Keep original left the model unchanged. The document menu opened the image file chooser for Markdown and omitted Insert image for LaTeX. The secondary Formal preset opened from More and reached review. Escape closed Writing tools.

Screenshots: [idle desktop](screenshots/editor-focus/01-idle-desktop.png), [edit prompt desktop](screenshots/editor-focus/02-edit-prompt-desktop.png), [review desktop](screenshots/editor-focus/03-review-desktop.png), [edit prompt narrow](screenshots/editor-focus/04-edit-prompt-narrow.png).
