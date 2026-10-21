import { describe, expect, it } from 'vitest';
import { buildLatexOutline } from '@/src/lib/latex-outline';

describe('buildLatexOutline', () => {
  it('builds a nested outline from LaTeX section commands', () => {
    const outline = buildLatexOutline(`\\documentclass{article}
\\begin{document}
\\section{Intro}
Text
\\subsection{Background}
More
\\section{Results}
\\end{document}`,
    'paper.tex', 5);

    expect(outline).toHaveLength(1);
    expect(outline[0].name).toBe('paper.tex');
    expect(outline[0].children?.map((node) => node.name)).toEqual(['Intro', 'Results']);
    expect(outline[0].children?.[0].children?.map((node) => node.name)).toEqual(['Background']);
    expect(outline[0].children?.[0].active).toBe(false);
    expect(outline[0].children?.[0].expanded).toBe(true);
    expect(outline[0].children?.[0].children?.[0].active).toBe(true);
  });

  it('keeps the root active before the first heading', () => {
    const outline = buildLatexOutline(`\\begin{document}
Preamble-ish prose
\\section{Intro}`,
    'draft.tex', 1);

    expect(outline[0].active).toBe(true);
    expect(outline[0].children?.[0].active).toBe(false);
  });

  it('cleans simple LaTeX commands inside section titles', () => {
    const outline = buildLatexOutline(`\\begin{document}
\\section{Related \\emph{Work} \\& Prior Art}`,
    'draft.tex', 2);

    expect(outline[0].children?.[0].name).toBe('Related Work & Prior Art');
  });
});
