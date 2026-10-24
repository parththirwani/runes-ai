# Runes AI light-theme migration plan

For page-by-page layout, typography, component states, and review criteria, see [the product light design spec](docs/product-light-design-spec.md).

## Goal

Bring the documents dashboard, editor, dialogs, and supporting states into the light visual language already used by the landing, start, and sign-in pages. Keep the document workflow intact: create, search, edit, review AI changes, save, compile, and export.

This plan defines the system before changing product screens. The dashboard and editor currently mix shared dark tokens with many hard-coded `#1e1e1e`, `#252526`, gray, white, and emerald classes. A global color inversion would leave Monaco, the PDF viewer, diff review, loading states, and overlays inconsistent.

## Design system to implement

### Color roles

Use semantic roles in `src/app/globals.css`; components consume roles rather than hex values. The existing landing colors are the starting values.

| Role | Value | Use |
| --- | --- | --- |
| Canvas | `#FAFAF7` | Main page and workspace background |
| Surface | `#FFFFFF` | Cards, editor panels, menus, dialogs |
| Surface raised | `#F4F2EA` | Code samples, toolbar hover, inset panels |
| Text primary | `#17201B` | Headings and body copy |
| Text secondary | `#46554E` | Supporting copy and labels |
| Text muted | `#65736A` | Metadata, placeholders, captions |
| Border | `#E3E2D9` | Dividers and resting controls |
| Border strong | `#CFCDC0` | Active edges and hover emphasis |
| Action | `#1D5A43` | Primary buttons, links, selected controls |
| Action hover | `#174834` | Hover and pressed states |
| Action subtle | `#EAF1ED` | Selected rows and gentle highlights |
| Focus | `#1D5A43` | Two-pixel keyboard focus outline |
| Error | `#9C3A2E` / `#F6E4E0` | Errors and removed diff text |
| Warning | `#80641D` / `#F4EED9` | Unsaved or stale-PDF state |
| Info | `#2C5AA0` / `#E6EEF8` | Compilation in progress |

The leaf logo uses its supplied green artwork. Do not use that brighter green as a text or button color. A rendered PDF page remains white; its surrounding viewer uses the canvas and surface roles. Diff states must include the words **Added** and **Removed**, as well as color.

### Typography

- **Geist Sans**, already loaded through `next/font`, is the UI face for navigation, controls, body copy, dialogs, tables, and document lists.
- **Georgia** is the display face used on the current public pages. Use it for product page headings and empty-state headlines, not for dense toolbars or form labels. Keep this choice until all screens have been reviewed together; a future font change must be made across public and product pages in one pass.
- **Geist Mono** is for source text, filenames, extensions, line numbers, status details, and code. Monaco should use the same mono family with fallbacks.
- Type scale: display `48/52` on wide screens and `36/40` on mobile; page heading `32/38`; section heading `24/30`; card heading `18/24`; body `16/26`; compact UI `14/20`; metadata `12/16`. Use 600 weight for UI headings and 400 to 500 for body and labels.
- Keep body lines near 60 to 75 characters in prose. Toolbars and document rows may be denser, but text and controls must remain legible at 200% zoom.

### Layout and components

- Shared spacing scale: `4, 8, 12, 16, 24, 32, 48, 64` px. Page gutters are 24 px on mobile and 32 px on desktop; the dashboard content width is capped at 1088 px. The editor fills the viewport and may have denser internal spacing.
- Use 8 px radius for controls, 12 px for panels, and 16 px for large cards and dialogs. Use a subtle border before adding a shadow; reserve the soft shadow for elevated dialogs and the main creation card.
- Define and review button, icon button, input, tab, badge, menu, modal, and toast states: default, hover, focus, active, disabled, loading, error, and success. Minimum interactive target: 44 px on touch layouts.
- Status colors carry meaning only. Saved, unsaved, compiling, stale PDF, and failure need distinct text labels and icon or shape cues.
- Keep the current Runes leaf mark and a readable “Runes AI” wordmark on both canvas and surface backgrounds.

## Migration sequence

### 1. Token and component foundation

1. Consolidate the public light palette and current product tokens into one semantic source in `src/app/globals.css`. Remove the root `<html className="dark">` only when product screens no longer depend on it.
2. Update `src/app/components/ui` and `src/app/components/design` primitives to use semantic roles. Make focus, disabled, loading, and destructive states consistent.
3. Add a visual reference page or Storybook equivalent for primitives and status examples. Capture desktop and mobile screenshots before replacing page styles.

**Gate:** Public pages still render as they do now; primitive components pass keyboard navigation and contrast checks.

### 2. Documents dashboard

Convert `dashboardPage`, `dashboardHeader`, toolbar, grid and list cards, format filter, empty state, skeletons, document actions, and create/delete dialogs. Keep both grid and list modes, search/filter behavior, and the `/document?create=MARKDOWN|LATEX` format handoff. Use the serif face only for the main heading and empty-state headline.

**Gate:** Create, search, filter, open, and delete work in both view modes; menus and dialogs remain readable and operable on narrow screens.

### 3. Editor shell and source

Convert `TopNavBar`, `DocumentEditor`, `WorkspacePanel`, `FileTree`, `FileTabs`, `ViewModeToggle`, and `AiWorkspacePanel`. Replace hard-coded dark backgrounds and gray classes with semantic tokens. Give Monaco a deliberate light theme: canvas-white editing surface, readable syntax colors, selection and line highlight, visible cursor, and a mono size around 14 px with comfortable line height. Keep code and prose syntax distinct.

**Gate:** File navigation, tabs, outline, save, source download, view changes, shortcuts, and editor focus still work. Test long filenames, split panes, and 200% zoom.

### 4. Review and output surfaces

Convert `DiffReview`, Markdown reading preview, `PDFPreview`, `PdfCanvasPreview`, compile states, and error panels. Treat the white PDF page as a document within a slightly warmer viewer. Check accepted versus rejected source, stale PDF status, compile progress, and failures. Do not let green/red alone explain a diff.

**Gate:** AI proposal accept/reject, undo, Markdown reading view, PDF compile, download, and stale indicators work in both Markdown and LaTeX documents.

### 5. Remove legacy styling and verify

Search product components for remaining dark hex colors, `text-white`, gray utility classes, and legacy emerald accents. Review each remaining occurrence; white PDF pages and semantic white-on-action text are valid exceptions. Remove unused dark tokens only after all consumers are migrated. Update the UI documentation and screenshots.

Run TypeScript, lint on touched files, the relevant unit tests, the production build, and a browser smoke pass. Capture desktop and mobile screenshots of dashboard, editor source, split view, diff review, PDF preview, dialogs, loading, empty, and error states. Check keyboard focus, contrast, overflow at 390 px, reduced motion, and 200% zoom.

## Definition of done

- Every user-facing product route and modal uses the defined light roles and type scale, with no accidental dark panels.
- The landing, start, sign-in, dashboard, and editor read as one product; the leaf logo is consistent throughout.
- Existing document and AI workflows pass smoke checks without behavioral regressions.
- Color contrast meets WCAG AA for normal text and controls; status and diff meaning remains available without color.
- Screenshots and design tokens are documented so future components do not reintroduce one-off colors or typography.
