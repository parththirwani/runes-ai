# Runes AI website redesign research

Light mode landing page and product UI direction. Research snapshot: 24 October 2026.

## Executive summary

Runes AI should lead with the document a person can finish: write in Markdown or LaTeX, review a suggested prose change, and export a PDF. The current landing page leads with LaTeX, although the product supports both formats. Its strongest distinction is editorial control: AI suggests a change, shows a diff, and waits for approval.

The recommended direction is a light, editorial interface built around that workflow. Use a warm white canvas, dark ink, one restrained green action color, and a real demonstration of source, review, and output. Carry the same visual system into the dashboard and editor so the landing page describes the product people actually enter.

This is a qualitative review of live pages and the Runes repository. It does not establish which design converts best.

## Scope and method

I reviewed the current homepages of four YC companies with useful document or artifact workflows: [Anara](https://anara.com/) ([YC S24](https://www.ycombinator.com/companies/anara)), [Extend](https://www.extend.ai/) ([YC W23](https://www.ycombinator.com/companies/extend)), [Reducto](https://reducto.ai/) ([YC W24](https://www.ycombinator.com/companies/reducto)), and [Drafted](https://www.drafted.ai/) ([YC P26](https://www.ycombinator.com/companies/drafted)). I also reviewed [Granola](https://www.granola.ai/) and [Notion AI](https://www.notion.com/product/ai) as adjacent writing and product storytelling references. YC batch dates establish company context; the observations concern their live pages on the research date.

For Runes, I checked the [README](../README.md), [landing page](../src/app/page.tsx), [hero](../src/app/components/landing/hero.tsx), [features](../src/app/components/landing/features.tsx), [global tokens](../src/app/globals.css), [dashboard](../src/app/components/dashboard/dashboardPage.tsx), and [editor](../src/app/components/editor/DocumentEditor.tsx).

## Shared patterns in the reference pages

| Pattern | Evidence | Design lesson for Runes |
| --- | --- | --- |
| A job before a feature list | Anara opens with research that shows its work. Extend names document processing tasks. Reducto says "Turn documents into data." Drafted names the output, house plans. | State the document outcome before mentioning Monaco, models, or compilation. |
| Product proof near the first action | Anara shows research objects and cited answers. Drafted shows plans and the steps that produce them. Granola shows notes inside the product. | Show selected prose, the review diff, and the resulting PDF near the hero CTA. |
| Evidence beside claims | Extend and Reducto pair claims with benchmarks, examples, and customers. | Use verifiable product behavior. Do not invent users, logos, accuracy figures, or testimonials. |
| A clear first action | The reviewed pages make signup, trial, or creation easy to find. | Keep "Start writing" dominant and make the workflow preview a quiet secondary action. |
| Task sequence below the fold | Drafted explains how an input becomes an editable result; Anara walks through search, library, and cited answers. | Arrange sections in the order a Runes user writes, reviews, compiles, and exports. |

These are recurring page structures, not a recipe to copy. Runes should keep its own brand and show its actual editor behavior.

## Runes today

The current site has a real editor screenshot, a visible primary CTA, and specific copy about approved AI edits. Those are worth keeping. The main gaps are scope and visual continuity:

- The hero says "Write LaTeX with reviewed AI edits." Markdown is absent from the headline and several supporting sections, although the app supports Markdown documents.
- The hero shows source and PDF. The controlled diff, which best explains the AI behavior, appears later.
- The marketing token system defines a dark theme. The dashboard and editor also use hard-coded charcoal colors, so changing only the landing page would leave a sharp visual break.
- The repo has separate [marketing button](../src/app/components/ui/button.tsx) and [editor button](../src/app/components/design/Button.tsx) implementations. A shared light system needs one control contract and consistent states.

## Recommended design direction

**Positioning.** Lead with a writing outcome and the approval model. A headline to test is "Write the document. Review every AI edit." Follow it with a single sentence that names Markdown, LaTeX, diff approval, and PDF export. This is proposed copy, not a measured winner.

**Visual language.** Use paper-like whitespace and precise borders so the document remains the focal point. Proposed starting tokens are canvas `#FAFAF7`, work surface `#FFFFFF`, ink `#17201B`, and action green `#1D5A43`. These are design candidates; verify every text, control, and focus combination in the rendered UI. Keep Geist for application controls. Let document content carry any editorial type accent.

**Imagery.** Use a real Runes workflow capture if the redesigned product is available. If not, make an honest HTML/CSS illustration labeled as an illustration. Show only states the product supports. Avoid glowing orbs, abstract 3D forms, fake dashboards, fabricated customer marks, and tiny unreadable screenshots.

**Motion.** Use short, purposeful state transitions for the source-to-review-to-PDF sequence. Respect reduced-motion preferences. Do not make core information depend on autoplay.

## Landing page structure

1. **Navigation:** Runes wordmark; "Workflow" and "Features" anchors; "Sign in"; one primary "Start writing" action.
2. **Hero:** outcome-led headline, one explanatory sentence, primary CTA, quiet workflow link, and a legible product view. On mobile, place proof directly after the copy.
3. **Workflow proof:** three states using the same short sample document: select prose, inspect and accept a diff, see the current PDF. Explain that rejection leaves source unchanged.
4. **Format choice:** concise Markdown and LaTeX examples. Show why each exists without implying separate products.
5. **Control and reliability:** describe protected markup, explicit approval, undo, and a visible stale-PDF state in plain language. Keep detailed implementation rules in product documentation.
6. **Secondary features:** outline navigation, ghost text completion, reading preview, and export. Give these less visual weight than the main loop.
7. **Final CTA and footer:** repeat "Start writing"; provide product and sign-in links with clear labels.

## Component work to support the redesign

1. Define semantic light tokens for canvas, surfaces, text, borders, action, focus, code, and status. Apply them to landing, dashboard, and editor.
2. Consolidate buttons and shared fields, tabs, badges, dialogs, and empty states. Specify default, hover, focus, disabled, loading, and error states.
3. Redesign the editor chrome around source and output readability. The diff must retain explicit "Added" and "Removed" labels or equivalent text, not color alone.
4. Keep saved, unsaved, compiling, stale PDF, and error states distinct and legible in light mode.
5. Capture new product imagery after the product screens use the new system.

## Validation before release

Test the landing page and one complete path through document creation, proposed edit, approval, and PDF preview at desktop and narrow mobile widths. Ask first-time viewers what Runes does after five seconds, then observe whether they can locate the review step. Record comprehension and task completion separately from CTA clicks.

Meet [WCAG 2.2 AA text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html): at least 4.5:1 for regular text and 3:1 for large text. Check [the 24 by 24 CSS pixel target minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) or its spacing exceptions. Also check keyboard focus, reduced motion, mobile line lengths, and empty and error states.

## Source notes

- [Anara](https://anara.com/) and its [YC profile](https://www.ycombinator.com/companies/anara)
- [Extend](https://www.extend.ai/) and its [YC profile](https://www.ycombinator.com/companies/extend)
- [Reducto](https://reducto.ai/) and its [YC profile](https://www.ycombinator.com/companies/reducto)
- [Drafted](https://www.drafted.ai/) and its [YC profile](https://www.ycombinator.com/companies/drafted)
- [Granola](https://www.granola.ai/) and [Notion AI](https://www.notion.com/product/ai)
- [W3C contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [W3C target size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

All external pages were accessed on 24 October 2026. Competitor performance and marketing claims were not independently tested.
