// Turns raw Tectonic/TeX output into workspace-relative diagnostics.
//
// Only compiler text is parsed. Server paths are stripped so a log line can never leak
// the job directory to the browser.

export type CompileDiagnostic = {
  file: string | null;
  line: number | null;
  message: string;
};

const MAX_EXCERPT_LINES = 40;
const MAX_MESSAGE_LENGTH = 400;

// Tectonic prints canonical TeX errors as "error: <file>:<line>: <message>".
const TECTONIC_ERROR = /^error:\s*(?:\.[/\\])?([^\s:][^:]*):(\d+):\s*(.+)$/;
const BARE_ERROR = /^error:\s*(.+)$/;
const LATEX_ERROR = /^!+\s*(?:LaTeX Error:|Package\s+\S+\s+Error:)?\s*(.+)$/;
// TeX prints the file it is reading as "(./path/file.tex" when it opens it.
const OPENED_FILE = /\((?:\.\/|\.\\)?([^\s()]+\.(?:tex|sty|cls|bib))/g;

function isSafeRelativePath(raw: string): boolean {
  const cleaned = raw.replace(/\\/g, '/');
  if (!cleaned || cleaned.includes('..')) return false;
  if (cleaned.startsWith('/') || /^[a-zA-Z]:/.test(cleaned)) return false;
  return true;
}

/**
 * TeX prints paths without the .tex extension, e.g. "chapters/broken:2:". Matching
 * against the snapshot's known files turns those back into real workspace paths.
 */
function normalizePath(raw: string, known: Set<string>): string | null {
  if (!isSafeRelativePath(raw)) return null;
  const cleaned = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\.\.\//, '');
  const lower = cleaned.toLowerCase();
  if (known.has(lower)) return known.has(lower) ? lower : cleaned;
  if (known.has(lower + '.tex')) return lower + '.tex';
  if (/\.(tex|sty|cls|bib|png|jpe?g|gif|pdf|eps)$/i.test(cleaned)) return cleaned;
  return null;
}

function tidy(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * Best effort list of diagnostics, most specific first. `currentFile` is the workspace
 * main file and is used when TeX reports an error without naming a file.
 */
export function parseCompileErrors(
  output: string,
  knownFiles: string[],
  mainFile: string,
): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];
  // Original casing comes from the snapshot; matching is case-insensitive like TeX.
  const known = new Map(knownFiles.map((file) => [file.toLowerCase(), file]));
  const resolve = (candidate: string): string | null => {
    const resolved = normalizePath(candidate, new Set(known.keys()));
    return resolved ? known.get(resolved) ?? null : null;
  };
  let lastFile: string | null = mainFile;

  for (const line of output.split('\n')) {
    OPENED_FILE.lastIndex = 0;
    let opened: RegExpExecArray | null;
    while ((opened = OPENED_FILE.exec(line)) !== null) {
      const candidate = resolve(opened[1]);
      if (candidate) lastFile = candidate;
    }

    const tectonic = TECTONIC_ERROR.exec(line);
    if (tectonic) {
      const resolved = resolve(tectonic[1]);
      diagnostics.push({
        file: resolved ?? lastFile,
        line: Number.parseInt(tectonic[2], 10),
        message: tidy(tectonic[3]),
      });
      continue;
    }

    const latex = LATEX_ERROR.exec(line);
    if (latex) {
      diagnostics.push({ file: lastFile, line: null, message: tidy(latex[1]) });
      continue;
    }

    const bare = BARE_ERROR.exec(line);
    if (bare && !tectonic) {
      diagnostics.push({ file: lastFile, line: null, message: tidy(bare[1]) });
    }
  }

  const unique: CompileDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const duplicate = unique.some(
      (other) => other.file === diagnostic.file && other.line === diagnostic.line && other.message === diagnostic.message,
    );
    if (!duplicate) unique.push(diagnostic);
  }
  return unique;
}

/** Human readable, path-aware summary used as the job error string. */
export function formatCompileError(diagnostics: CompileDiagnostic[], fallback: string): string {
  if (diagnostics.length === 0) return tidy(fallback) || 'Compilation failed';
  return diagnostics
    .slice(0, 5)
    .map((d) => (d.file ? (d.line ? d.file + ':' + d.line + ': ' + d.message : d.file + ': ' + d.message) : d.message))
    .join('\n');
}

/** Trims raw engine output to a bounded, path-free excerpt for the editor log pane. */
export function errorExcerpt(output: string): string {
  return output.split('\n').slice(-MAX_EXCERPT_LINES).join('\n').slice(-8000);
}
