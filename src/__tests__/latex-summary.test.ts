import { describe, expect, it } from "vitest";
import {
  EMPTY_SUMMARY_LABEL,
  documentBody,
  flattenCommands,
  stripComments,
  summarizeLatex,
  tidyText,
} from "../lib/latex-summary";

const TEMPLATE = `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{Empty Scratchpad}
\\author{Your Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Start writing your document here.

\\end{document}`;

const NOTES = `\\documentclass{article}
\\usepackage{amsmath}

\\title{Quantum Decoherence Notes}
\\author{A. Researcher}

\\begin{document}
\\maketitle

\\begin{abstract}
Decoherence explains why macroscopic superpositions are never observed: interaction with the environment suppresses interference terms.
\\end{abstract}

\\section{Introduction}
A system entangled with an unobserved environment loses phase coherence \\citep{zurek2003}, as \\emph{reference 214} shows. % TODO: pointer states

\\begin{equation}
\\rho_{ij} \\longrightarrow \\rho_{ij} e^{-t/\\tau_d}
\\end{equation}

Cost is 5 \\$ per sample and 12\\% margin.
\\end{document}`;

const TABLE_DOC = `\\documentclass[12pt]{report}
\\usepackage{booktabs}
\\begin{document}
\\chapter{Related Work}
Earlier compilers rebuilt the whole document for every edit, which made iteration slow.

\\begin{table}
\\centering
\\begin{tabular}{lrr}
\\toprule
System & Seconds \\\\
\\midrule
Legacy & 41.7 \\\\
\\bottomrule
\\end{tabular}
\\end{table}
\\end{document}`;

describe("summarizeLatex", () => {
  it("returns null for missing or empty content", () => {
    expect(summarizeLatex(null)).toBeNull();
    expect(summarizeLatex(undefined)).toBeNull();
    expect(summarizeLatex("   ")).toBeNull();
  });

  it("returns null for the untouch ed default template instead of leaking source", () => {
    expect(summarizeLatex(TEMPLATE)).toBeNull();
    expect(EMPTY_SUMMARY_LABEL.length).toBeGreaterThan(0);
  });

  it("never leaks LaTeX markup into the summary", () => {
    const summary = summarizeLatex(TABLE_DOC);
    expect(summary).not.toBeNull();
    expect(summary).not.toMatch(/\\/);
    expect(summary).not.toMatch(/[{}[\]]/);
    expect(summary).not.toContain("documentclass");
    expect(summary).not.toContain("12pt");
    expect(summary).not.toContain("report");
    expect(summary).not.toContain("booktabs");
    expect(summary).not.toContain("toprule");
  });

  it("keeps real prose and drops preamble structure", () => {
    expect(summarizeLatex(TABLE_DOC)).toContain("Earlier compilers rebuilt the whole document");
    expect(summarizeLatex(TABLE_DOC)).not.toContain("Related Work");
  });

  it("drops maths and table data but keeps surrounding prose", () => {
    const summary = summarizeLatex(NOTES);
    expect(summary).toContain("Decoherence explains why macroscopic superpositions");
    expect(summary).not.toContain("rho");
    expect(summary).not.toContain("tau");
    expect(summary).not.toContain("longrightarrow");
  });

  it("removes citations, comments and command arguments while keeping emphasis text", () => {
    const summary = summarizeLatex(NOTES, 400);
    expect(summary).not.toContain("zurek");
    expect(summary).not.toContain("TODO");
    expect(summary).not.toContain("citep");
    expect(summary).toContain("reference 214");
  });

  it("unescapes punctuation used in prose", () => {
    const summary = summarizeLatex(NOTES, 400);
    expect(summary).toContain("5 $ per sample");
    expect(summary).toContain("12% margin");
  });

  it("ignores the preamble when there is no document environment", () => {
    const fragment = "Just a paragraph of prose written without any wrapper at all, on purpose.";
    expect(summarizeLatex(fragment)).toBe(fragment);
  });

  it("truncates on a word boundary inside the requested budget", () => {
    const long = `\\begin{document} ${"alpha ".repeat(200)} \\end{document}`;
    const summary = summarizeLatex(long, 80);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(81);
    expect(summary!.endsWith("…")).toBe(true);
    expect(summary!.trimEnd().endsWith("…alpha")).toBe(false);
  });

  it("treats placeholder copy as no content", () => {
    const todo = "\\begin{document}\nTODO: write the abstract here\n\\end{document}";
    expect(summarizeLatex(todo)).toBeNull();
  });

  it("keeps list item prose", () => {
    const list = `\\begin{document}
\\begin{itemize}
  \\item We measured 214 participants across four sites during the pilot.
  \\item The annotation guidelines were published in March.
\\end{itemize}
\\end{document}`;
    const summary = summarizeLatex(list);
    expect(summary).toContain("We measured 214 participants");
    expect(summary).not.toContain("item");
  });
});

describe("helpers", () => {
  it("strips comments but keeps escaped percent signs", () => {
    expect(stripComments("cost is 5\\% \\label{x} % note")).toBe("cost is 5\\% \\label{x} ");
  });

  it("returns the body between begin and end document", () => {
    const body = documentBody("\\documentclass{article}\n\\begin{document}\nhello\n\\end{document}\ntrailing");
    expect(body.trim()).toBe("hello");
  });

  it("flattens commands but keeps their text arguments for the tidy pass", () => {
    expect(flattenCommands("a \\emph{careful} sentence")).toBe("a {careful} sentence");
    expect(tidyText(flattenCommands("a \\emph{careful} sentence"))).toBe("a careful sentence");
  });
});
