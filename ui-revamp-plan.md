# Runes AI UI revamp plan

## Design read

Reading this as a redesign of a LaTeX writing app for researchers and students, with a focused, credible product language built around the existing dark theme and green brand mark. Preserve the current routes and recognizable logo artwork. Use a more editorial landing page and a practical document workspace.

Target design dials: `DESIGN_VARIANCE 6`, `MOTION_INTENSITY 3`, `VISUAL_DENSITY 4` for marketing; `4 / 2 / 6` for the document workspace. Keep Tailwind v4 and the existing button/component foundation. Use one icon family and one spacing, type, color, and radius system across both areas. The design-taste-frontend guidance applies to the landing page. Treat the document list and editor as product UI with stronger information hierarchy and responsive controls.

## Current state, verified on 21 October 2026

| Area | Finding | Evidence |
| --- | --- | --- |
| Google sign-in | Successful OAuth explicitly redirects to `/`, so users return to the landing page. | `src/app/actions.ts:7` |
| Get Started Free | The desktop and mobile nav link to `/chat`; there is an API route but no `/chat` page. The 404 page also links to `/chat`. | `src/app/components/landing/navbar.tsx:69`, `:110`; `src/app/not-found.tsx:103` |
| Other calls to action | The hero's View Demo button, lower Get Started Free and Schedule Demo buttons, and pricing buttons have no navigation/action. Nav Docs points to `#docs`, but no section has that ID. Footer social links use `#`. | `src/app/components/landing/hero.tsx`, `CTA.tsx`, `pricing.tsx`, `navbar.tsx`, `footer.tsx` |
| Documents | The grid card preview strips only simple commands with a regex, so LaTeX arguments, environments, and template text can leak into the description. List and grid duplicate date formatting. The API sorts by `createdAt` while cards emphasize `updatedAt`. | `src/app/components/dashboard/documentGrid.tsx:23`; `documentList.tsx`; `src/app/api/document/route.ts` |
| Documents layout | The page has a heading, count, search, and uniform cards; empty and loading states are sparse. Delete controls appear only on hover, making them hard to discover with touch or keyboard. | `dashboardPage.tsx`, `documentGrid.tsx`, `documentList.tsx`, `emptyState.tsx` |
| Icons | Most icons are already from `lucide-react`, not emoji. The real issue is generic usage and inconsistent treatment. Some visible checkmarks are text glyphs and one loading icon is hand-written SVG. | Icon imports under `src/app`; `CTA.tsx`; `src/app/components/design/Button.tsx` |
| Logo | `/logo.png` is a 408×612 portrait canvas with a small horizontal wordmark in the middle, yet headers declare it as 200×32. `/small-logo.png` is a 683×1024 portrait canvas and the footer gives it very large boxes. The art has substantial transparent margins. | `public/logo.png`, `public/small-logo.png`; `navbar.tsx`, `dashboardHeader.tsx`, `TopNavBar.tsx`, `footer.tsx` |
| Landing design | At 1440px the features section is six equal dark cards in a 3×2 grid. The hero uses centered text, green blur, a fake editor preview, and trust logos inside the hero. Mobile places the CTA below a long paragraph and the logo wall near the bottom of the first screen. | Rendered screenshots plus `hero.tsx`, `features.tsx` |
| Site polish | `globals.css` contains duplicate token layers, unused Vite starter styles, and an invalid remote stylesheet URL in `@font-face`. `layout.tsx` loads Geist but the body specifies Inter and still has Create Next App metadata. | `src/app/globals.css`, `src/app/layout.tsx` |
| Marketing accuracy | The page claims templates, Git integration, citation search, end-to-end encryption, SOC 2, real-time collaboration, paid tiers, institutional trust, and other capabilities. These claims were not supported by the app routes found in this audit. Verify each before retaining it. | `features.tsx`, `howItWorks.tsx`, `pricing.tsx`, `signin/page.tsx`, `hero.tsx` |

The landing screenshots were inspected at 1440×900 and 390×844. This audit did not run a real Google OAuth flow or inspect a populated documents page in the browser. Those remain explicit verification tasks.

## Agent execution plan

### 1. Repair the entry path (P0)

1. Change the Google sign-in destination in `src/app/actions.ts` to `/document`. Preserve any intentional post-login destination if the user came from a protected document route; reject external callback URLs.
2. Make all sign-up/start-writing CTAs lead to the same flow: authenticated users go to `/document`, guests to `/signin`, then `/document`. Replace `/chat` links in nav and 404. Prefer a shared destination helper or server-side auth-aware link so labels cannot drift again.
3. Audit every visible CTA and nav item. Give each an actual destination or remove it. Do not invent a demo, documentation site, sales channel, or paid checkout. Keep a single label for the primary signup intent.

Done when Google sign-in lands on `/document`, the original protected destination works where applicable, no CTA leads to 404 or `#`, and keyboard/mobile navigation follows the same flow.

### 2. Establish the visual foundation (P1)

1. Extract the existing green, charcoal, wordmark, and rune mark into a small documented token set. Keep a consistent dark theme; design a light counterpart only if light mode is included in this release. Set typography to the already-loaded Geist family, define a clear heading/body/metadata scale, and consolidate duplicated CSS tokens. Remove starter CSS and unused glow utilities.
2. Produce tightly cropped derivatives of the existing logo artwork: horizontal wordmark for headers and compact mark for narrow contexts. Preserve the logo drawing itself. Use a shared logo component with intrinsic dimensions, explicit variants, and consistent alignment in landing nav, dashboard, editor, and footer. Verify at desktop and mobile sizes.
3. Replace the icon set with one family, recommended `@phosphor-icons/react` (`bun add @phosphor-icons/react`). Migrate all `lucide-react` imports together. Define standard sizes and weight, accessible names for icon-only buttons, and visible focus states. Avoid decorative icons where a label communicates more clearly.

Done when logo proportions match the source artwork, icon treatment is consistent, no controls rely on hover alone, and there is no mixed icon family or stray decorative emoji/glyph.

### 3. Redesign the documents page (P1)

1. Replace the regex preview with a deliberate summary. Best option: store an optional plain-text excerpt derived from document content on create/save using a tested LaTeX-to-text utility. For existing records, calculate a conservative fallback that ignores preamble, commands, comments, and template boilerplate. If no useful prose exists, show a useful empty label instead of raw code.
2. Keep `updatedAt` because it helps users find recent work, but make it secondary. Sort by `updatedAt` descending, format dates in one shared utility, and show an absolute date in a tooltip or accessible label. Never say Today for a future date.
3. Give documents a stronger working layout: recent documents first, a prominent New document action, search with a clear result count, restrained list/grid switch, and compact cards or rows that emphasize title and actual content. Show created/updated metadata only where it adds value. Make delete a named menu/action that works by keyboard and touch, with a confirmation step.
4. Design distinct loading skeletons, genuinely empty workspace, no-search-results, fetch-error, and deletion-error states. Keep the existing create/open/delete behavior and responsive list density.

Done when no raw LaTeX appears in previews, sort and displayed date agree, 0/1/many/search/error states are clear, and all document actions work at 390px and by keyboard.

### 4. Recompose the landing page (P1)

1. Audit each marketing claim against real product capability. Remove or rewrite unsupported claims and fake social proof before visual work. Keep only verified features, pricing, customer logos, and testimonials. Correct the page title and description.
2. Shorten the hero to one clear value statement, concise supporting text, and one working primary CTA. Move the university logos out of the hero only if permission and evidence support the trust claim. Replace the fake editor mockup with an actual captured product screenshot or a live, truthful component preview. Reserve its aspect ratio to avoid layout shift.
3. Rebuild Features around the user's real workflow. Use one featured capability with an authentic product visual, followed by asymmetric supporting items. Avoid six identical cards, repeated green icon boxes, and claims about unbuilt features. Give each section a distinct layout role and natural copy.
4. Simplify How it Works, pricing, and closing CTA so the page does not repeat the same signup pitch. If billing is not implemented, remove the pricing table until the offer is real. Use restrained motion that honors reduced-motion settings. Keep the brand green as the single accent and use fewer glows.
5. Check desktop, tablet, and mobile layouts together: one-line desktop nav, CTA visible in the first viewport, readable text, proportionate images, no horizontal overflow, and consistent spacing.

Done when every displayed claim and link is real, sections have distinct compositions, the mobile hero reaches its CTA without excess scrolling, and Lighthouse/visual checks reveal no major layout or contrast issues.

### 5. Editor and cross-page QA (P2)

1. Inspect editor top bar, file tree, modals, sign-in, 404, and footer at 390, 768, 1024, and 1440px. Fix wrapping, clipping, oversized logo use, and controls that become unreachable. Preserve editor behavior and document URLs.
2. Check focus order, keyboard access, accessible names, text/button contrast, reduced motion, responsive image sizing, loading/error feedback, and browser console errors.
3. Run typecheck/build and existing tests. Add focused tests for auth destination, CTA destinations, and LaTeX summary extraction. Run an end-to-end smoke test for Google OAuth in an environment where the provider is configured, plus document create/open/search/delete and mobile layout checks.

Done when those checks pass and the agent supplies before/after screenshots for the landing hero, features, documents grid/list/empty state, sign-in, and editor at desktop and mobile widths.

## Order of delivery

Ship the auth and broken-link fixes first. Then deliver the shared tokens, logo, and icons so the remaining pages use one visual language. Redesign documents next, then landing, then the editor and full QA pass. Keep each change set reviewable and avoid altering route slugs, the existing logo drawing, document data, or editor behavior without a reason tied to these tasks.
