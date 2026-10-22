# Markdown documents: requirements and implementation plan

Status: implementation brief for an overnight agent. Written 21 October 2026.

## Goal

When creating a document, a user chooses **LaTeX** or **Markdown**. Both formats have the same core writing loop: edit source, save and autosave, use AI prose suggestions with explicit review, generate a PDF, preview it, and download it. Markdown also has a fast rendered reading preview while the user edits. The dashboard makes the format obvious without splitting documents into separate products.

This brief is for a complete, working Markdown path. A format badge or Markdown syntax highlighting without a real PDF compile does not satisfy it. Preserve the existing LaTeX path and existing document URLs.

The implementation agent should branch from the latest `origin/ai-native-build` in a separate worktree and open a PR targeting `ai-native-build`. This file is uncommitted in the current checkout. Copy it into the new worktree and commit it only on the feature branch. Do not edit, commit, stash, or reset the existing checkout, and do not merge the PR.

## Repository facts and related work

- `prisma/schema.prisma` has one `Document` with `content: String` and no format. `src/schema/documentSchema.ts` validates only title and content. Existing rows are LaTeX and must stay LaTeX after migration.
- `src/hooks/useDashboard.ts` creates a LaTeX template without a format choice. `dashboardPage.tsx` uses a title-only modal. Grid and list cards have no format field and currently derive previews from a LaTeX-specific regex.
- `src/app/document/[slug]/page.tsx` loads one document into `DocumentEditor.tsx`. That component holds save, compile, PDF, AI proposal, and view-mode state. `MonacoEditorWrapper.tsx` defaults to `latex` and registers LaTeX snippets.
- The compile route always enqueues the saved source as a LaTeX job. `worker/worker.ts` always calls `compileLatexToPDF`. Job and PDF endpoints already protect access by submitting user.
- AI completion and paraphrase routes contain LaTeX-specific prompts and validation. The client scans LaTeX context and uses Monaco proposals. The review, stale-result checks, and exact-range acceptance are valuable shared behavior, but the Markdown syntax rules must differ.
- `compile-workspace-plan.md` describes a separate multi-file workspace and compile-performance change. Markdown must fit its file/snapshot model if that work is merged. Do not independently invent an incompatible file store. If it is not merged, implement the smallest owned asset store needed for local Markdown images in this PR and document how it will map to workspace files. Do not make the whole Markdown feature depend on an unmerged PR.

## Product decisions

| Decision | Requirement |
| --- | --- |
| Format identity | `Document.format` is an immutable `LATEX` or `MARKDOWN` value set at creation. A rename does not convert a document. Conversion between formats is outside this release. |
| Existing documents | Backfill every existing record to `LATEX`. Keep IDs, slugs, titles, content, chats, and links. |
| Markdown source | Store plain UTF-8 Markdown. A new Markdown document starts with a short useful template, not a TeX preamble. If workspace files exist, the main file is `main.md`; otherwise `Document.content` remains the source until workspace integration. |
| Supported Markdown | Headings, paragraphs, emphasis, links, lists, task lists, blockquotes, fenced code, tables, thematic breaks, images, and inline/display math. Use a documented CommonMark/GFM profile with math support. Do not advertise features absent from either reading preview or PDF. |
| Raw HTML | Treat raw HTML in Markdown as unsupported source text. Never execute scripts or render unsanitized HTML. |
| Remote resources | PDF generation must not fetch arbitrary remote URLs or local `file:` URLs. For the first release, remote images show a clear unsupported-resource error. Ordinary clickable external links may remain links after URL validation. |
| PDF | The existing Compile action produces a PDF for both formats. The source type selects the compiler on the server; users never submit an arbitrary compiler command. |
| Preview | Markdown shows source, a fast rendered reading preview, or a split view. The generated PDF remains reachable in the preview area with a clear switch or tab. The reading preview can update while typing; the PDF updates only after explicit Compile. |
| AI | Ghost-text completion, selected-text paraphrase, diff review, Accept/Reject, stale checks, rate limits, and provider-error behavior apply to Markdown prose. Markdown syntax and protected regions require Markdown-specific handling. |

## Required user journeys

### R1. Create and find documents

1. The dashboard's **New document** flow asks for title and format in one accessible dialog. Two clearly named choices explain the result: "LaTeX, source and PDF" and "Markdown, source, reading preview and PDF". Use one consistent default, preferably Markdown for a general writing flow; persist the user's explicit choice for the create request. Do not infer format from title or pasted content.
2. Show a format badge or file-extension cue on every grid card and list row. Use the same visual treatment in search results, loading states, and recently created records. Type must be readable without relying only on color or icon shape.
3. Search can find documents of either format. Add an All / Markdown / LaTeX filter in grid and list views. Keep title search, date sorting, delete, empty, no-results, and error states working. A dashboard summary must not leak raw TeX commands, Markdown syntax, or unsafe HTML; derive plain-text excerpts by format on the server or a tested shared utility.
4. A document opens at its existing `/document/[slug]` URL. The editor title bar indicates its format and the main file extension. Existing LaTeX links continue to open the LaTeX editor.

### R2. Edit Markdown with feature parity

1. Use Monaco's Markdown language with syntax highlighting, line numbers, find, selection, undo/redo, bracket/quote pairing, and keyboard shortcuts. Keep source value, cursor, selection, and scroll stable across preview and AI panel changes. Set a stable model URI for each document or workspace file.
2. Provide local Markdown snippets or completions for headings, links, images, code fences, tables, and task lists. LaTeX-only command snippets must never appear in a Markdown model.
3. Keep save, autosave, Ctrl/Cmd+S, title edit, unsaved-state indicator, and document switching. A pending AI proposal is never saved or compiled before Accept. Reject changes zero bytes. An accepted change is one undoable edit.
4. Show a document outline derived from Markdown headings. If the workspace branch replaces the file tree, show the outline separately from files. Do not present a heading outline as a real file tree.
5. Include useful keyboard and touch behavior at narrow widths. Users can reach source, reading preview, PDF, Compile, Save, AI controls, and error messages without hover.

### R3. Rendered reading preview

1. Render the current unsaved Markdown locally or through a bounded preview service with a short debounce. Preserve ordinary scroll behavior and avoid reinitializing Monaco on every preview update. A preview error does not block source editing.
2. Support the syntax listed above. Code fences show their language where provided; unknown languages remain readable. Tables and long code wrap or scroll within the preview. Images resolve only from validated workspace assets or an approved local asset path. Show alt text and a clear missing-image state.
3. Sanitize or reject raw HTML and dangerous URLs. Never use `dangerouslySetInnerHTML` on user Markdown without a reviewed sanitizer and tests. Block `javascript:`, `data:` where unsafe, `file:`, and scheme-relative resource fetches. Keep linked headings and external links usable without allowing them to replace the app origin unexpectedly.
4. Make the reading preview and PDF use the same declared Markdown feature set. Their typography may differ, but headings, lists, code, tables, math, images, and links must retain meaning. Keep fixture tests for both outputs to catch parser differences.
5. Label the reading preview as current source and the PDF as the latest successful compile. If source changes, show that the PDF is outdated; do not label the current reading preview as outdated.

### R4. Compile Markdown to PDF

1. Extend the authenticated compile route and job type with a server-derived format and immutable source snapshot. Dispatch `LATEX` jobs to the existing Tectonic path and `MARKDOWN` jobs to a Markdown compiler. Reject mismatched or missing format data; do not trust client-provided type as authority.
2. Recommended first implementation: install a pinned Pandoc executable in the isolated compiler image and use `--from=gfm+tex_math_dollars` or an explicitly tested equivalent, `--pdf-engine=tectonic`, a pinned PDF template/options, and a chosen font set. Pandoc's manual documents Tectonic as a PDF engine and resource paths for images. Confirm the exact format flags against the pinned Pandoc version in tests. Do not shell-interpolate user content or allow user-supplied engine options.
3. Supply only the selected Markdown source and validated local assets from the same saved snapshot. Use a per-job working directory, bounded process time, memory and output size, disabled network access, and no shell escape. Reject remote image references and path traversal before running Pandoc. PDF metadata and temporary file names must not reveal server paths or secrets.
4. Support headings, links, lists, task lists, code blocks, tables, images, and math in the PDF. Include page breaks and typography defaults suitable for an ordinary report. A clear compile error must identify unsupported resources, malformed math, missing assets, and engine failure where possible.
5. Keep job ownership, rate limits, cancellation where supported, result TTL, PDF download, and stale-result handling. A Markdown job cannot accidentally enter the TeX-source compiler with its raw Markdown bytes. The performance work in `compile-workspace-plan.md` should apply to both formats when merged.
6. Provide a source `.md` download. PDF download stays the same action and content type. An HTML export is outside this release unless it falls out cleanly from the reviewed renderer and can be secured.

### R5. AI prose tools for Markdown

1. Make `POST /api/ai/complete` and `POST /api/ai/paraphrase` format-aware using the owned document's stored format. Reuse authentication, per-user quotas, request caps, timeouts, and stale-request handling. Do not let a client claim `MARKDOWN` for a LaTeX document.
2. Completion offers short prose insertions at the caret, not a rewritten section. Suppress it in YAML front matter, fenced or inline code, link destinations, image URLs, raw HTML, table delimiter rows, and structural Markdown syntax. Math spans are protected. When classification is uncertain, do not suggest.
3. Paraphrase accepts selected prose, including prose containing emphasis or links only when syntax can be preserved exactly. Protect inline code, URLs, image syntax, math, link destinations, reference definitions, front matter, and code fences by masking or by rejecting the selection with a reason. Preserve list prefixes and heading markers. Do not allow a provider response to insert raw HTML or change link targets.
4. Show the same word-level diff and explicit Accept/Reject controls as LaTeX. Verify exact document identity, model version/range, and original selected bytes before Accept. Reject/no-op/stale outcomes do not mark source dirty. An accepted proposal marks the PDF stale.
5. AI provider absence, rate limits, and errors do not block editing, saving, rendered preview, or PDF compilation. Keep document text and provider output out of production logs.

### R6. Access, migration, and compatibility

1. Add a Prisma `DocumentFormat` enum or equivalent constrained database field with a non-null `LATEX` default for old rows. Include an explicit backfill in the migration and verify all old IDs keep their data and links. New creation requires an explicit format in the API contract; legacy clients may receive a documented LaTeX default during transition.
2. Update API response types and validation consistently across create/list/get/update, editor page, dashboard, worker job, and tests. Format is immutable through normal document update routes. Store format on the job snapshot for reliable worker dispatch, but derive it from the owned database row at enqueue.
3. Keep old LaTeX documents, their AI behavior, PDF jobs, and preview working. Do not silently convert old content to Markdown. Deleting a document removes or expires its associated assets and results according to the existing retention policy.
4. Decide integration with the multi-file workspace branch before changing storage tables. If both features are developed in parallel, isolate the format field/compiler dispatch so it can be rebased onto the workspace file model. The final app must use one shared document identity and one dashboard.

## UI specification

| Area | Markdown state | LaTeX state |
| --- | --- | --- |
| Create dialog | Title plus selected Markdown tile; short sample/template description. | Title plus selected LaTeX tile; existing TeX template description. |
| Dashboard card/row | "Markdown" badge and `.md` cue, plain-text excerpt, updated date, same open/delete actions. | "LaTeX" badge and `.tex` cue, plain-text excerpt, updated date, same actions. |
| Editor toolbar | `name.md`, Save, Compile PDF, source/reading/split modes, PDF access, AI controls. | `name.tex`, existing source/split/PDF modes and controls. |
| Source pane | Monaco Markdown tokens and Markdown snippets. | Existing Monaco LaTeX tokens and snippets. |
| Preview pane | Reading preview from current source; PDF tab/pane from last successful compile, with stale marker. | Existing PDF preview with stale marker. |
| Outline/navigation | Markdown heading hierarchy and current position. | Existing LaTeX section outline. |
| Empty/error states | No PDF yet, compiling, unsupported resource, missing image, render failure, provider failure. | Preserve current LaTeX states and improve shared labels if needed. |

Use the existing dark theme and component system. The format picker must have a visible selected state, keyboard selection, labels read by screen readers, and a clear Create button. Show grid/list layouts at 390, 768, 1024, and 1440 pixels. Do not redesign the entire marketing site as part of this work.

## Suggested implementation sequence

1. **Baseline and schema.** Run existing checks. Add format to Prisma and Zod/types, backfill old rows, and add typed creation templates. Add create/list/get/update tests before changing the editor.
2. **Dashboard.** Replace the title-only create modal with title and format choices. Add badges, filters, format-aware excerpts, and empty/error states. Verify create/open/delete for both types.
3. **Editor split.** Extract shared document state, save/compile/PDF, proposal review, and toolbar behavior from LaTeX-specific context rules. Add a Markdown editor configuration and reading preview. Keep both formats on `/document/[slug]`.
4. **Compiler dispatch.** Pin Pandoc and Tectonic in the worker image, add Markdown job execution and PDF output handling, then validate local assets and errors. Share queue, job-status, ownership, and PDF endpoints. Keep compilers isolated behind one typed interface.
5. **Markdown AI.** Add format-specific prompts, context detection, protected-token validation, and local snippets. Reuse proposal stale checks and diff review. Test that protected syntax cannot change.
6. **Integration and QA.** Rebase or integrate the multi-file workspace model if available. Run API, worker, browser, accessibility, and visual checks. Update README, configuration, and deployment notes. Open a PR only when a real Markdown PDF can be created and viewed.

## Deliverables

1. Prisma migration and backfill, typed API contracts, and two tested creation templates.
2. A dashboard creation flow, format badges/filter/excerpts, and responsive grid/list states.
3. Markdown Monaco source editing, rendered reading preview, heading outline, source download, and the shared save/AI/PDF UI.
4. A production-configured Markdown-to-PDF worker path with pinned dependencies, safe asset resolution, useful diagnostics, and existing job/PDF access controls.
5. Markdown-specific AI completion and paraphrase with syntax protection, diff review, exact acceptance, and stale-result handling.
6. Tests, migration proof, screenshots, README/deployment updates, and a PR handoff that lists exact commands run, failures, limitations, and any workspace-branch dependency.

## Test matrix and release checks

| Area | Required checks |
| --- | --- |
| Migration | Old document count and content hashes match after backfill. Old slugs open LaTeX, and old PDF compilation still succeeds. |
| Creation/API | Authenticated user creates each type with the correct template. Invalid format, format change by update, duplicate title, oversized content, anonymous access, and wrong-owner access fail correctly. |
| Dashboard | Grid/list, search, All/Markdown/LaTeX filter, sorting, excerpts, empty states, delete, keyboard and touch actions work with mixed document types. |
| Editing | Markdown syntax, local snippets, find, undo/redo, source download, save/autosave, title edit, document switch, and stable cursor/model behavior work. LaTeX regression path still works. |
| Reading preview | Headings, tables, tasks, nested lists, fenced code, math, links, and local images render. Raw HTML and unsafe URLs do not execute or fetch. Long content and mobile widths remain usable. |
| PDF compile | A Markdown fixture compiles to a nonempty readable PDF; headings, table, code, math, and local image appear. Missing asset, remote image, invalid path, malformed source, timeout, and worker error produce useful failures. TeX documents still route to Tectonic. |
| AI | Completion appears only in Markdown prose and is discarded after stale edits or navigation. Paraphrase cannot change URL, code, math, front matter, or Markdown structure; Accept is one undoable edit, Reject changes zero bytes. Missing provider and 429 leave editing usable. |
| Security | Raw HTML, script URLs, image fetches to private hosts, `file:` references, path traversal, cross-user document/job/PDF access, and unbounded input fail safely. No raw source or secrets appear in error logs. |
| Visual and access | Capture mixed dashboard and both editors at desktop and mobile widths. Check visible focus, accessible names, keyboard order, contrast, reduced motion, and console errors. |

Run `./node_modules/.bin/tsc --noEmit`, `./node_modules/.bin/vitest run`, `./node_modules/.bin/eslint .`, and `bun run build`. Run the browser smoke test with local Postgres, Redis, worker, and PDF engine, extending it to create and compile one document of each format. Report the exact result of each command. If a provider or service is unavailable, state the specific blocker and run the remaining tests; do not call an unrun check passing.

## Acceptance criteria

- [ ] Existing documents and their links remain LaTeX with byte-identical saved source.
- [ ] A user selects Markdown or LaTeX when creating a document and sees the type in both dashboard layouts.
- [ ] Markdown has Monaco editing, reading preview, save/autosave, outline, AI completion/paraphrase/review, PDF compile/preview/download, and source download.
- [ ] LaTeX retains its current editor, AI, compile, and PDF behavior.
- [ ] Reading preview and PDF agree on the declared supported syntax for tested fixtures.
- [ ] Untrusted Markdown and assets cannot execute code, fetch arbitrary resources, or access another user's data.
- [ ] Typecheck, tests, build, browser compile for both formats, and visual/access checks are recorded in the PR.

## Technical references

- [Pandoc user's guide](https://pandoc.org/MANUAL.html) documents Markdown input, PDF engines including Tectonic, resource paths, and security limits for untrusted input. Pin and test the chosen version rather than relying on unspecified defaults.
- [react-markdown documentation](https://github.com/remarkjs/react-markdown/blob/main/readme.md) describes React rendering and its default handling of raw HTML. Add only reviewed plugins and test URL handling.
- [remark security guidance](https://github.com/remarkjs/remark#security) recommends sanitization, input limits, and bounded processing for untrusted Markdown.
