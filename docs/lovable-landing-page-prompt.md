# Lovable prompt for the Runes AI landing page

Paste the prompt below into Lovable. Attach the Runes AI repo if Lovable can read it. The research brief is [ui-ux-research-2026.md](./ui-ux-research-2026.md).

---

Build a responsive, light-mode landing page for **Runes AI**, a document editor for Markdown and LaTeX. Users write source, review AI prose suggestions in a diff before accepting them, compile a PDF, and export it. The page should feel like a precise writing tool. Make the product workflow the visual center of the design.

If this project is connected to the Runes repo, work within its Next.js and Tailwind setup. The current landing entry is `src/app/page.tsx`, with sections under `src/app/components/landing/`. The primary CTA already uses `StartWritingLink`, which sends guests to sign-in and signed-in users to documents. Preserve that behavior. Do not change backend, auth, document, or editor logic as part of this landing-page build.

## Art direction

- Use a warm paper canvas (`#FAFAF7`), white work surfaces (`#FFFFFF`), near-black ink (`#17201B`), and one deep green action color (`#1D5A43`). Treat these as starting values and adjust them if contrast checks require it.
- Keep Geist or a similarly clear sans-serif for UI. Use strong type hierarchy and generous spacing. Let the sample document provide the editorial texture.
- Use crisp 1px borders, restrained radius, and very soft shadows only where they explain layering. The page should remain legible without shadows or animation.
- Create a distinctive layout through the document and review workflow. Avoid glowing gradients, abstract 3D shapes, floating glass cards, stock photos, random sparkles, oversized icon grids, and decorative analytics.
- Use the Runes leaf mark in `/brand-logo.png`, with a readable “Runes AI” text label beside it. Keep the green restrained.

## Required page sequence

1. **Header.** Wordmark at left. Links to "Workflow" and "Features". "Sign in" as a quiet link. One primary "Start writing" action at right. Provide a usable mobile menu with keyboard support.
2. **Hero.** Use this headline as a starting point: **"Write the document. Review every AI edit."** Supporting copy: "Draft in Markdown or LaTeX, inspect suggested prose changes, and export a clean PDF from one workspace." Primary CTA: **Start writing**. Secondary text link: **See the workflow**. Give the hero one dominant product view, not several competing graphics.
3. **Interactive product story.** Show three selectable states using the same short, realistic sample paragraph: **Write**, **Review**, **Export**. Write shows source and a readable preview. Review shows a proposed change with visible "Removed" and "Added" labels, plus "Accept" and "Reject" buttons. Export shows the PDF preview and a clear "Current" or "Needs compile" state. The interaction is a landing-page demonstration; it must not pretend to edit a real document. Keep all key content visible when motion is reduced.
4. **Formats.** A compact Markdown / LaTeX switch that changes a short source example and its label. Explain both formats in plain language. Avoid claiming feature parity that the repo does not support.
5. **Why this workflow matters.** Explain the actual controls: AI suggestions are reviewed before they apply, accepted changes remain undoable, and the preview indicates when the PDF is older than the source. Use product UI fragments and short captions instead of generic feature cards.
6. **Final action.** Repeat the primary CTA with a short line about starting a document. Add a minimal footer with product anchors, sign-in, and the Runes identity.

## Product fidelity

- Runes supports Markdown and LaTeX. It is not only a LaTeX editor.
- AI prose completion is optional and accepted with Tab. Paraphrase suggestions require a user review step. Do not imply the AI silently rewrites the document.
- The document can be compiled to PDF. The PDF may become stale after source changes, and the UI reports that state.
- The repo includes `/product/editor-split.png` and `/product/ai-workspace.png`. They are genuine screenshots of the current dark UI. Use them only if they remain readable in the layout. If they clash with the new light visual direction, build a clearly labeled **illustrative UI demo** in HTML/CSS using the product behavior above. Do not recolor the screenshots or present an invented light UI as a captured product screenshot.
- Do not invent user counts, customer logos, testimonials, benchmark results, pricing, integrations, collaboration, or research citations.

## Responsive and accessible behavior

- At 1440px, the hero copy and product view should both be legible within the first screen, with the product view large enough to read key labels.
- At 768px and 375px, stack the content in a natural reading order. Keep the primary CTA and demo controls easy to tap. Avoid horizontal overflow and text inside tiny mockups.
- Meet WCAG 2.2 AA text contrast. Provide visible keyboard focus, semantic buttons and links, meaningful image alt text, and reduced-motion behavior. Use text labels as well as color for diff and status states.
- Use subtle transitions of about 150–250ms only where they help show a state change. Do not autoplay a long animation or hide the product story behind hover.

## Implementation and delivery

- Build the landing page and its reusable landing components. Keep section components small enough to edit later. Use semantic design tokens rather than repeated hex values inside components.
- Use one consistent button treatment across the landing page. Preserve the existing CTA destination behavior if the repo is connected.
- Produce a complete page, not a generic hero mockup. Check desktop and mobile layouts, working anchors, menu behavior, tab interactions, focus states, and reduced-motion mode.
- At the end, briefly list the files changed, the page sections built, and any imagery that is illustrative rather than a real screenshot.

The result should feel specific to an editor where the author stays in control of AI changes. The readable document, the diff, and the PDF are the design assets.
