# Product light design spec

## Purpose

Bring every page after sign-in into the visual system of the finished landing page. The landing page, `/start`, and `/signin` are the reference. This document covers `/document`, `/document/[slug]`, the global 404 page, and every loading, empty, error, dialog, menu, and preview state reached from them. It is a design and implementation brief; no product UI changes are implied by this file.

The existing [migration plan](../plan.md) sets the sequence and broad acceptance gates. This spec defines what each screen should look like and which current components must change.

## Visual reference and rules

Use the actual public-page styles in `src/app/landing-redesign.css`, `src/app/globals.css`, and `src/app/components/landing-redesign` as the reference. The public pages use a warm off-white canvas, white cards, dark green action color, fine neutral borders, restrained shadows, and a serif display face. The product should share those choices while giving dense editing controls more space-efficient layouts.

| Role | Token or value | Product use |
| --- | --- | --- |
| Page canvas | `#FAFAF7` | Dashboard, 404, outer editor shell |
| Main surface | `#FFFFFF` | Cards, panels, toolbars, dialogs, source editor |
| Inset surface | `#F4F2EA` | Code samples, hover and selected neutral areas |
| Primary text | `#17201B` | Headings, body, document content |
| Supporting text | `#46554E` | Descriptions and secondary labels |
| Muted text | `#65736A` | Metadata and placeholders |
| Border | `#E3E2D9` | Default rules and panel edges |
| Strong border | `#CFCDC0` | Hover emphasis and section boundaries |
| Action | `#1D5A43` | Main buttons, links, active controls |
| Action hover | `#174834` | Hover and pressed controls |
| Action tint | `#EAF1ED` | Selected rows and quiet success states |

Use the existing `status-*` tokens for saved, unsaved, compiling, stale, and error states. Use the leaf logo from `src/app/components/brand/logo.tsx`. Do not substitute the old neon emerald palette. A white-on-green label or button is a valid exception to the dark text rule.

The landing's soft shadow belongs on floating menus and dialogs. Most product panels need a 1 px border and no shadow. Reserve the warm canvas for page background and gutters; keep reading, source editing, and PDF pages white. Avoid decorative gradients and blurred glows in the workspace.

## Typography

| Content | Face | Size and line height | Notes |
| --- | --- | --- | --- |
| Product page title | Georgia | `32/38` desktop, `28/34` narrow | Use on `Documents` and major empty/error headings |
| Section title | Geist Sans | `20/28` | Use within cards and panels |
| Card title | Geist Sans | `16/24`, weight 600 | Document names and dialog titles |
| Body and descriptions | Geist Sans | `16/26` | Use on spacious pages and states |
| Controls and dense UI | Geist Sans | `14/20`, weight 500 | Toolbars, tabs, buttons, labels |
| Metadata | Geist Sans | `12/16` | Counts, timestamps, status labels |
| Source, paths, code | Geist Mono | `14/22` in editor, `12/18` for paths | Also use for line numbers and diagnostics |
| Reading preview | Georgia | `17/28` body | Headings follow a clear document hierarchy |

The serif face marks reading or page hierarchy. It must not appear in file tabs, toolbar buttons, form labels, or code. Match the public pages' tight heading tracking and generous body line height. Keep document names readable before truncating; provide the full name in a tooltip or accessible label when truncated.

## Page and component decisions

### `/document`: documents dashboard

- Use the same 64 px header height, logo treatment, 68 rem content width, and 24/32 px responsive gutters as the public pages. The dashboard header can add an account action, but it should use the same border, type, and icon rhythm.
- Put the serif `Documents` heading above a plain document count. The create action is the primary green button. Search, Markdown/LaTeX filters, and grid/list switch use one 44 px control height and consistent focus rings.
- Grid cards and list rows use white backgrounds and thin neutral borders. The document name is the strongest element; format, last update, and actions are secondary. Hover may raise the border or use a light tint. Selection must be distinguishable without relying only on green.
- Empty state: explain whether there are no documents or no results for the current query. Offer `Create document` for a new account and `Clear filters` for a filtered empty result. Keep copy short and concrete.
- Create and delete dialogs share the white dialog style and common buttons. The format choice remains visible when `/document?create=MARKDOWN` or `LATEX` opens the dialog. Destructive actions use the error role and explicit text.
- Replace the current full-screen dark spinner and red error strip with light loading skeletons and an in-page error notice. Keep the search, filter, grid/list, create, open, and delete behavior intact.

Relevant files: `src/app/components/dashboard/*`, `src/app/components/design/*`, and `src/app/document/page.tsx`.

### `/document/[slug]`: editor and workspace

- Treat the editor as a working tool, not a marketing page. Use a compact white top bar, warm outer canvas, thin pane dividers, and restrained 8 to 12 px radii. The document title and save state remain visible. Green marks the active action or view, not every icon.
- File tree and tabs use a white or very light neutral background. Active file state needs a green left rule or tint plus readable text; hover and keyboard focus are separate states. Long paths truncate safely. Monaco source stays monospace and has a light syntax palette, visible caret, readable selection, and line highlight.
- Source, split, and preview views retain their current behavior. In split view, use a single clear divider between source and output. On narrow screens, use the existing view switch or stacked arrangement rather than squeezing both panes below readable width.
- The AI workspace and diff review use white panels. Show original and proposed text in clearly labeled blocks. Use `Added` and `Removed` words as well as line decoration and status colors. Keep Accept, Reject, Regenerate, stale proposal, and error states distinct. Acceptance remains disabled when the proposal is stale.
- Markdown reading view uses Georgia for document prose. Code blocks and inline code use Geist Mono on an inset neutral background. LaTeX source stays monospace. The PDF viewer background is warm neutral, while rendered pages remain white with a subtle page shadow. PDF toolbar, compile progress, stale badge, zoom, download, and failure states use the same control and status tokens as the editor.
- Loading and load-error screens use the light shell and a direct route back to Documents. Do not display a dark full-screen frame while the route resolves.

Relevant files: `src/app/document/[slug]/page.tsx` and `src/app/components/editor/*`.

### Global 404 page

The 404 page currently inherits the dark `bg-background` and dark code panel. Give it the warm canvas, serif heading, white diagnostic card, and green action links. Keep the LaTeX error metaphor and its navigation links. It must work for signed-out visitors.

Relevant file: `src/app/not-found.tsx`.

## Shared components and states

Update `src/app/components/design` and the shared UI button before converting individual screens. Define one treatment for primary, secondary, quiet, and destructive buttons; icon buttons; text inputs; tabs; badges; menus; and dialogs. Each needs default, hover, focus, active, disabled, loading, and error states where applicable. All interactive targets are at least 44 px on touch layouts. A compact desktop toolbar may use a smaller visible control if its hit target remains 44 px.

Use short status text with an icon or shape cue: `Saved`, `Unsaved`, `Compiling`, `PDF outdated`, and `Failed`. For destructive confirmations, keep the document name visible and put focus inside the dialog on open. On close, return focus to the initiating control. Preserve existing keyboard shortcuts and navigation.

## Implementation boundaries

1. Move the landing's color and type decisions into the semantic roles in `src/app/globals.css`. Today the root roles are dark and the public light colors are separately scoped under `.landing-redesign`. Unify those values before deleting the root `dark` class in `src/app/layout.tsx`. Update the viewport theme color to the light canvas.
2. Convert shared controls and 404, then dashboard, then the editor shell, then Monaco, AI review, Markdown, and PDF views. Change one screen at a time so it can be checked before old dark tokens are removed.
3. Replace hard-coded `#1e1e1e`, `#252526`, `#2d2d2d`, `text-white` on dark panels, gray utility text, and old emerald actions in product components. Review each result manually. White PDF paper and white button text on green remain correct.
4. Keep the current product behaviors and route structure. This work changes the visual system and usability of the screens, not document storage, authentication, AI proposals, or compilation logic.

## Review checklist

Capture desktop and 390 px mobile views of the dashboard in populated, empty, filtered-empty, loading, and error states; create and delete dialogs; editor source, split, Markdown reading, PDF preview, compilation, AI diff, stale proposal, load failure; and the 404 page. Compare them with `/`, `/start`, and `/signin` in the same browser session.

Check readable contrast at WCAG AA, visible keyboard focus, 200% zoom, long document names, long filenames, dialog focus behavior, reduced motion, and no horizontal overflow. Run the existing document-flow tests and a browser smoke pass for create, search, filter, open, edit, save, proposal accept/reject, compile, and download. The migration is done when every user-facing product state uses the light roles and typography above, without an accidental dark panel or a broken document flow.
