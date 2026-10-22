// LaTeX -> plain text excerpt for document previews.
//
// The previous implementation was a single regex that stripped command names
// but left their arguments, so `\documentclass[12pt]{report}` surfaced as
// `[12pt][report]` in the card description. This module instead removes the
// parts of a file that are never prose, keeps the parts that are, and returns
// null when nothing worth showing survives, so the UI can render a label
// instead of raw source.
//
// Environments are located with a small scanner rather than regexes, because
// LaTeX nesting is easier to read here than to express in a pattern.
//
// Pure functions only - safe to call from the API route and from tests.

const BACKSLASH = String.fromCharCode(92);

// Environments whose contents are data, not prose.
const NON_PROSE_ENVIRONMENTS = [
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "flalign", "flalign*",
  "gather", "gather*", "multiline", "multiline*", "split", "eqnarray", "eqnarray*",
  "array", "cases", "matrix", "pmatrix", "bmatrix", "vmatrix", "Vmatrix", "smallmatrix",
  "tabular", "tabularx", "array*", "longtable", "table", "table*", "figure", "figure*",
  "tikzpicture", "forest", "minted", "verbatim", "verbatim*", "lstlisting", "alltt",
  "thebibliography", "filecontents", "comment", "lrbox", "scope",
];

// Structural commands are removed together with their arguments.
const STRUCTURAL_COMMANDS = [
  "documentclass", "usepackage", "RequirePackage", "input", "include", "IncludeInTikz",
  "title", "author", "date", "thanks", "and", "maketitle", "tableofcontents",
  "listoffigures", "listoftables", "bibliography", "bibliographystyle", "addbibresource",
  "part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph",
  "label", "ref", "cref", "autoref", "pageref", "eqref", "nameref",
  "cite", "citep", "citet", "Citep", "Citet", "nocite", "bibitem", "parencite", "textcite",
  "footnote", "marginpar", "includegraphics", "href", "url", "hyperref",
  "setlength", "setcounter", "newcommand", "renewcommand", "providecommand", "declareoperator",
  "definecolor", "definecolorset", "graphicspath", "hypersetup", "pagenumbering", "thispagestyle",
  "pagestyle", "linenumbers", "emergencystretch", "selectlanguage", "keywords",
];

// Text that ships with a brand new document, plus the usual placeholders.
// It is prose, but it says nothing about the draft.
const BOILERPLATE_PATTERNS = [
  /^start writing your document here\.?$/,
  /^your (text|content|abstract|title) goes here\.?$/,
  /^lorem ipsum\b/,
  /^to-?do\b/,
  /^t-?b-?d\b/,
  /^placeholder\b/,
  /^this (document|paper|report|section) is (a )?(template|placeholder|sample)\.?$/,
  /^add (your |the )?(content|text|summary) here\.?$/,
];

const MIN_PROSE_LETTERS = 20;

function isEscapeChar(chars: string[], index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && chars[i] === BACKSLASH; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

/** Remove `% comment` tails, leaving escaped `\%` alone. */
export function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      const chars = line.split("");
      for (let i = 0; i < chars.length; i += 1) {
        if (chars[i] === "%" && !isEscapeChar(chars, i)) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

/** Everything between \begin{document} and \end{document}, or the whole file. */
export function documentBody(source: string): string {
  const beginToken = BACKSLASH + "begin{document}";
  const endToken = BACKSLASH + "end{document}";
  const begin = source.indexOf(beginToken);
  if (begin < 0) return source;
  const start = begin + beginToken.length;
  const end = source.indexOf(endToken, start);
  return end < 0 ? source.slice(start) : source.slice(start, end);
}

/** Cut every `\begin{name} ... \end{name}` block, including its contents. */
export function removeEnvironments(source: string, names: string[]): string {
  let text = source;
  for (const name of names) {
    const beginToken = BACKSLASH + "begin{" + name + "}";
    const endToken = BACKSLASH + "end{" + name + "}";
    let searchFrom = 0;
    for (;;) {
      const begin = text.indexOf(beginToken, searchFrom);
      if (begin < 0) break;
      const end = text.indexOf(endToken, begin + beginToken.length);
      const stop = end < 0 ? text.length : end + endToken.length;
      text = text.slice(0, begin) + " " + text.slice(stop);
      searchFrom = begin + 1;
    }
  }
  return text;
}

/** Drop `$...$`, `$$...$$`, `\[...\]` and `\(...\)` maths. */
export function removeMath(source: string): string {
  const dollar = "$";
  const displayOpen = BACKSLASH + "[";
  const displayClose = BACKSLASH + "]";
  const inlineOpen = BACKSLASH + "(";
  const inlineClose = BACKSLASH + ")";

  const cut = (text: string, open: string, close: string, allowNewlines: boolean) => {
    let result = text;
    let searchFrom = 0;
    for (;;) {
      const start = result.indexOf(open, searchFrom);
      if (start < 0) break;
      if (isEscapeChar(result.split(""), start)) {
        searchFrom = start + open.length;
        continue;
      }
      const regionEnd = allowNewlines ? result.length : result.indexOf("\n", start + open.length);
      const limit = regionEnd < 0 ? result.length : regionEnd;
      const end = result.indexOf(close, start + open.length);
      if (end < 0 || end > limit) {
        searchFrom = start + open.length;
        continue;
      }
      result = result.slice(0, start) + " " + result.slice(end + close.length);
      searchFrom = start + 1;
    }
    return result;
  };

  let text = source;
  text = cut(text, dollar + dollar, dollar + dollar, true);
  text = cut(text, displayOpen, displayClose, true);
  text = cut(text, inlineOpen, inlineClose, true);
  // single $ pairs must stay on one line and must not be escaped
  text = text
    .split("\n")
    .map((line) => cut(line, dollar, dollar, false))
    .join("\n");
  return text;
}

/** Match a braced group starting at `index`; returns the index after it. */
function matchBracedGroup(text: string, index: number): number {
  if (text[index] !== "{") return index;
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === "{" && !isEscapeChar(text.split(""), i)) depth += 1;
    else if (text[i] === "}" && !isEscapeChar(text.split(""), i)) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return index;
}

function matchOptionalGroup(text: string, index: number): number {
  if (text[index] !== "[") return index;
  let depth = 0;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return index;
}

/**
 * Remove the listed commands with their optional and braced arguments, then
 * remove `\begin{}`/`\end{}` markers on their own.
 */
export function removeStructuralCommands(source: string, commands: string[]): string {
  const names = new Set(commands);
  const chars: string[] = [];
  let i = 0;

  const skipGroups = (index: number): number => {
    let cursor = index;
    for (;;) {
      while (cursor < source.length && (source[cursor] === " " || source[cursor] === "\t")) cursor += 1;
      const afterOptional = matchOptionalGroup(source, cursor);
      if (afterOptional !== cursor) {
        cursor = afterOptional;
        continue;
      }
      const afterBrace = matchBracedGroup(source, cursor);
      if (afterBrace !== cursor) {
        cursor = afterBrace;
        continue;
      }
      return cursor;
    }
  };

  while (i < source.length) {
    if (source[i] !== BACKSLASH || isEscapeChar(source.split(""), i)) {
      chars.push(source[i]);
      i += 1;
      continue;
    }
    const nameMatch = /^[a-zA-Z@]+\*?/.exec(source.slice(i + 1));
    if (!nameMatch) {
      chars.push(source[i]);
      i += 1;
      continue;
    }
    const name = nameMatch[0];
    const afterName = i + 1 + name.length;
    if (names.has(name)) {
      i = skipGroups(afterName);
      chars.push(" ");
      continue;
    }
    if (name === "begin" || name === "end") {
      i = matchBracedGroup(source, afterName) === afterName ? afterName : matchBracedGroup(source, afterName);
      chars.push(" ");
      continue;
    }
    chars.push(source[i]);
    i += 1;
  }

  return chars.join("");
}

const LAYOUT_COMMANDS = new Set([
  "ldots", "dots", "cdots", "vdots", "ddots", "hline", "cline", "linebreak",
  "newline", "par", "quad", "qquad", "hspace", "vspace", "noindent",
  "centering", "raggedright", "maketitle",
]);

const ESCAPED_PUNCTUATION = "%_#$&{}~^\\";

function isCommandNameChar(char: string): boolean {
  return (
    (char >= "a" && char <= "z") || (char >= "A" && char <= "Z") || char === "@"
  );
}

/**
 * Replace remaining commands with readable text: escaped symbols become
 * themselves, `\emph{careful}` keeps "careful".
 */
export function flattenCommands(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (char !== BACKSLASH) {
      output += char;
      index += 1;
      continue;
    }

    const next = source[index + 1] ?? "";

    // escaped punctuation: \% \_ \& \$ \# \{ \}
    if (next && ESCAPED_PUNCTUATION.includes(next)) {
      output += next === BACKSLASH ? " " : next;
      index += 2;
      continue;
    }

    let cursor = index + 1;
    while (cursor < source.length && isCommandNameChar(source[cursor])) cursor += 1;
    if (source[cursor] === "*") cursor += 1;

    if (cursor > index + 1) {
      const name = source.slice(index + 1, cursor);
      output += LAYOUT_COMMANDS.has(name) ? " " : "";
      index = cursor;
      continue;
    }

    // short symbol commands: `\,` `\;` `\ ` `\(` ...
    output += " ";
    index += 2;
  }

  return output;
}

export function tidyText(source: string): string {
  return source
    .replace(/``|''/g, '"')
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/`/g, "'")
    .replace(/~/g, " ")
    .replace(/[\{\}\[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function letterCount(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]/gu);
  return matches ? matches.length : 0;
}

function looksLikeBoilerplate(text: string): boolean {
  const normalised = text.trim().toLowerCase();
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(normalised));
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxChars * 0.6 ? lastSpace : maxChars;
  return slice.slice(0, cut).trimEnd() + "…";
}

/**
 * Short human-readable excerpt of the prose in a LaTeX file, or null when the
 * file holds nothing but structure or template filler.
 */
export function summarizeLatex(
  content: string | null | undefined,
  maxChars = 180,
): string | null {
  if (typeof content !== "string" || content.trim().length === 0) return null;

  const body = documentBody(stripComments(content));
  const prepared = flattenCommands(
    removeStructuralCommands(
      removeMath(removeEnvironments(body, NON_PROSE_ENVIRONMENTS)),
      STRUCTURAL_COMMANDS,
    ),
  );
  const text = tidyText(prepared);

  if (letterCount(text) < MIN_PROSE_LETTERS) return null;
  if (looksLikeBoilerplate(text)) return null;
  return truncate(text, maxChars);
}

/** Shown wherever summarizeLatex() returns null. */
export const EMPTY_SUMMARY_LABEL = "No prose yet";
