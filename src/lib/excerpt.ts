// Plain-text excerpt derivation for dashboard summaries.
// Output must never leak raw TeX commands, Markdown syntax, or HTML tags.

export type ExcerptFormat = 'LATEX' | 'MARKDOWN';

const EXCERPT_LENGTH = 90;

function stripLatex(source: string): string {
  let text = source
    .replace(/%.*/g, ' ')
    .replace(/\\begin\{document\}|\\end\{document\}|\\maketitle|\\tableofcontents/g, ' ');

  // Unwrap simple content commands (\textbf{x} -> x) a few levels deep.
  for (let i = 0; i < 3; i++) {
    const next = text.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, ' $1 ');
    if (next === text) break;
    text = next;
  }

  return text
    .replace(/\\[a-zA-Z]+\*?/g, ' ')
    .replace(/\\([%_&#$~^{}\\])/g, '$1')
    .replace(/[{}[\]~^&$]/g, ' ');
}

function stripMarkdown(source: string): string {
  let text = source
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/, '\n') // YAML front matter
    .replace(/```[\s\S]*?(```|~~~)/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])/g, ' ') // images: no syntax, no alt
    .replace(/\[([^\]]*)\](\([^)]*\)|\[[^\]]*\])/g, '$1') // links keep their text
    .replace(/^\s{0,3}\[[^\]]+\]:.*$/gm, ' ') // reference definitions
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ') // ATX heading markers
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2') // emphasis
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^\s{0,3}>\s?/gm, ' ') // blockquotes
    .replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/gm, ' ') // list/task markers
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, ' ') // table delimiter rows
    .replace(/\|/g, ' ') // table cells
    .replace(/^\s{0,3}([-*_])\s*(\1\s*){1,}$/gm, ' '); // thematic breaks

  // Drop anything that still looks like a raw HTML tag or autolink wrapper.
  text = text.replace(/<\/?[a-zA-Z!][^>]*>/g, ' ');
  text = text.replace(/<([a-zA-Z][a-zA-Z0-9+.-]*:[^>\s]+)>/g, '$1');

  return text;
}

export function plainTextExcerpt(source: string, format: ExcerptFormat): string {
  if (!source) return '';
  const stripped = format === 'MARKDOWN' ? stripMarkdown(source) : stripLatex(source);
  const plain = stripped
    .replace(/[<>]/g, ' ')
    .replace(/\\/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return '';
  return plain.length > EXCERPT_LENGTH ? `${plain.slice(0, EXCERPT_LENGTH).trimEnd()}…` : plain;
}
