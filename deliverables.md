# Deliverables and acceptance record

This is the overnight agent's completion checklist. Read `requirements.md` and `plan.md` first. The boxes below are **not yet checked**. Check an item only after implementing it and recording evidence. Update this file at the end of the coding run with links to relevant files, test output, and any remaining work.

## Definition of done

The task is complete when a signed-in owner can write in a real LaTeX editor, accept or dismiss prose ghost text, select prose for paraphrase, review its exact diff, accept or reject it, undo an acceptance, save, reload, and compile the accepted source. Stale AI results cannot overwrite user edits. Another user cannot read or cancel the owner's compilation result or use the owner's document as AI context. Automated tests cover those rules, and the final handoff distinguishes tested behavior from anything that could not be exercised locally.

## Feature checklist

### Editing baseline

- [ ] A real editor replaces the current textarea and supports LaTeX highlighting, line numbers, selection, find, and undo/redo.
- [ ] Local LaTeX command/environment completion does not interfere with AI prose completion.
- [ ] Save, autosave, compile, PDF preview/download, title edit, and all three view modes still work.
- [ ] The UI indicates when the PDF reflects older source than the current editor.

### AI autocomplete

- [ ] Ghost text appears in eligible prose after a brief idle period and inserts nothing until accepted.
- [ ] Tab accepts once; Escape dismisses; undo reverses acceptance.
- [ ] No AI request runs in preamble, comments, math, verbatim, command context, or with a selection/pending diff.
- [ ] New typing, cursor movement, a newer request, document switch, or cancellation invalidates an old response.
- [ ] Requests are bounded, debounced, cancelable, authenticated, owner-checked, and server rate-limited.
- [ ] Provider errors and 429 leave typing, saving, and compiling available.

### Paraphrase and diff

- [ ] A keyboard-accessible Paraphrase action works on an exact prose selection and offers Clearer, Shorter, and Formal tones or equivalent choices.
- [ ] The AI receives bounded context and returns replacement text without mutating the document.
- [ ] Commands, citations, references, math, labels, and environment syntax are preserved or an unsupported selection is rejected before any edit.
- [ ] Original and proposed text have a readable word-level diff with preserved whitespace and line breaks.
- [ ] Reject changes zero source bytes. Accept changes only the captured range and is one undoable operation.
- [ ] Stale proposals cannot be accepted. Repeated identical text elsewhere remains unchanged.
- [ ] Accepted edits use ordinary save/autosave and compilation. Rejected proposals do not mark source dirty.

### Access and correctness

- [ ] New AI routes authenticate, verify document ownership, validate inputs/outputs, and keep provider keys server-side.
- [ ] Existing exposed chat route is owner-checked, or its access is otherwise secured and the choice is documented.
- [ ] Job status, cancellation, and PDF result routes verify the submitting user.
- [ ] Model text is rendered as text, with no raw HTML insertion or secret/source leakage in errors and production logs.

## Required test evidence

Fill in the command, result, and a short note. "Blocked" needs an exact missing service or credential, not a guess.

| Check | Command or procedure | Result | Evidence or blocker |
| --- | --- | --- | --- |
| TypeScript | `./node_modules/.bin/tsc --noEmit` or package equivalent | Not run | |
| New unit/component tests | Test runner command | Not run | |
| Full automated suite | Test runner command | Not run | |
| Lint | `./node_modules/.bin/eslint .` or package equivalent | Not run | Compare with baseline: 46 errors, 22 warnings |
| Production build | `npm run build` / `bun run build` | Not run | |
| Browser: autocomplete | Type, Tab, Escape, undo, stale response | Not run | |
| Browser: paraphrase | Select, diff, Reject, Accept, undo/redo, save/reload | Not run | |
| Browser: compiler | Accept, save, compile, inspect/download PDF | Not run | |
| Cross-user API checks | AI, job status/cancel, PDF | Not run | |
| Accessibility smoke check | Keyboard focus, labels, diff contrast | Not run | |

## Must-pass test cases

These are behavior checks, not tests that merely mirror helper implementation.

1. The second of two identical sentences is paraphrased. Accept changes only that instance; Reject changes neither.
2. A delayed paraphrase arrives after the user edits the selected text. Accept is disabled and the new user text survives.
3. A delayed completion arrives after typing or a document switch. No suggestion appears and Tab cannot insert it.
4. A model response deletes `\cite{smith2020}`, changes `$E=mc^2$`, duplicates a protected token, or adds `\input{other}`. The proposal is rejected or never offered.
5. A multiline selection with blank lines and Unicode text keeps exact surrounding source before and after Accept, Reject, and undo.
6. The diff displays insertion, deletion, punctuation, and line-break changes without inserting display markup into the source.
7. An anonymous caller and a second user cannot generate AI output from the owner's document. The second user cannot poll, cancel, or download the owner's compilation job.
8. Failed or rate-limited AI calls leave the document editable and source byte-identical.
9. Saving and compiling after Accept use the accepted source; a pending or rejected candidate never enters the stored document or PDF.

## Final review record to fill in

### Files changed

List major files and why each changed. Include new packages and which lockfile was updated.

### User-visible behavior

Describe the exact controls and keyboard shortcuts. Include where suggestions and diff review appear, how stale results are shown, and how the PDF stale state is communicated.

### Verification performed

Copy the relevant command names, exit codes, test counts, and browser scenarios from the table. State whether a real OpenRouter response and a real Docker/Tectonic compile were tested. Do not claim those integrations work merely because mocks pass.

### Remaining issues and limitations

List incomplete requirements with file references and their effect on users. Separate pre-existing unrelated lint findings from failures introduced by this work. Record any untested runtime dependency or account setup.

### Review decision

Choose one and explain it with evidence:

- [ ] Ready for an owner to try locally.
- [ ] Feature-complete under mocked services, live integration still unverified.
- [ ] Incomplete, with the next concrete action identified.

## Scope reminder

This delivery concerns one-document LaTeX editing with AI prose autocomplete and selected-text paraphrase review. Do not mark multi-file projects, collaboration, rich-text editing, offline mode, or Overleaf parity as complete. The current sample file tree is not evidence of those features.
