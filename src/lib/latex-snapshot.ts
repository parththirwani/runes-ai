// Immutable compile snapshots.
//
// A snapshot is the transitive set of files the selected main file can reach, plus the
// compiler settings. Its digest is the compile cache key: any change to a path, a byte,
// the main file choice or a compiler option produces a different digest.

import {
  IMAGE_EXTENSIONS,
  TEX_EXTENSIONS,
  parentDirectory,
  pathsCollide,
} from './workspace-paths';

export type SnapshotInputFile = {
  path: string;
  checksum: string;
  revision: number;
  content?: string | null;
  storageKey?: string | null;
  kind: string;
  sizeBytes: number;
};

export type CompilerSettings = {
  engine: string;
  engineVersion: string;
  mainFile: string;
  options: string[];
};

export type SnapshotManifest = {
  version: 1;
  documentId: string;
  userId: string;
  mainFile: string;
  compiler: CompilerSettings;
  files: { path: string; checksum: string; revision: number; storageKey?: string | null }[];
};

export type SnapshotBundle = SnapshotManifest & {
  inline: { path: string; content: string }[];
};

export type Reference = {
  from: string;
  raw: string;
  command: string;
  /** Offset in the referencing file, so diagnostics follow document order. */
  index?: number;
};

const REFERENCE_PATTERNS: { command: string; regex: RegExp }[] = [
  { command: 'input', regex: /\\(?:input|subfile|SubFile|Import|inputfrom)\s*\{([^{}]*)\}/g },
  { command: 'include', regex: /\\include\s*\{([^{}]*)\}/g },
  { command: 'includegraphics', regex: /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g },
  { command: 'bibliography', regex: /\\bibliography\s*\{([^{}]*)\}/g },
  { command: 'addbibresource', regex: /\\addbibresource\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g },
  { command: 'graphicspath', regex: /\\graphicspath\s*\{([^{}]*)\}/g },
];

// Comments are not TeX, and \input inside \newcommand bodies still resolves at compile
// time, so only commented references are dropped.
export function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => {
      let index = 0;
      while (index < line.length) {
        const hash = line.indexOf('%', index);
        if (hash === -1) return line;
        if (line[hash - 1] === '\\') {
          index = hash + 1;
          continue;
        }
        return line.slice(0, hash);
      }
      return line;
    })
    .join('\n');
}

export function extractReferences(path: string, source: string): Reference[] {
  const text = stripComments(source);
  const found: Reference[] = [];
  for (const { command, regex } of REFERENCE_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const argument = match[1];
      if (!argument.trim()) continue;
      if (command === 'graphicspath') continue;
      if (command === 'bibliography' || command === 'addbibresource') {
        for (const part of argument.split(',')) {
          if (part.trim()) found.push({ from: path, raw: part.trim(), command, index: match.index });
        }
        continue;
      }
      found.push({ from: path, raw: argument.trim(), command, index: match.index });
    }
  }
  return found.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function candidateExtensions(command: string, raw: string): string[] {
  const lower = raw.toLowerCase();
  if (command === 'bibliography' || command === 'addbibresource') {
    return lower.endsWith('.bib') ? [raw] : [raw + '.bib'];
  }
  if (command === 'includegraphics') {
    if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return [raw];
    return [raw, ...IMAGE_EXTENSIONS.map((ext) => raw + ext)];
  }
  if (TEX_EXTENSIONS.some((ext) => lower.endsWith(ext))) return [raw];
  return [raw, raw + '.tex'];
}

/** Resolves one TeX reference against the workspace, honouring the referencing file's folder. */
export function resolveReference(reference: Reference, availablePaths: string[]): string | null {
  const normalizedRaw = reference.raw.replace(/\\/g, '/');
  if (normalizedRaw.startsWith('/') || /^[a-zA-Z]:/.test(normalizedRaw)) return null;
  if (normalizedRaw.split('/').some((segment) => segment === '..' || segment === '.')) return null;

  // TeX searches the job root, so the workspace root is tried first. The referencing
  // file's own folder is tried next, which is what Overleaf users expect from
  // \input{details} inside chapters/methods.tex.
  const folders = ['', parentDirectory(reference.from)];
  if (reference.command === 'includegraphics') folders.push('figures', 'figures/');
  const byLower = new Map(availablePaths.map((candidate) => [candidate.toLowerCase(), candidate]));

  for (const candidate of candidateExtensions(reference.command, normalizedRaw)) {
    for (const folder of folders) {
      const joined = folder ? folder.replace(/\/$/, '') + '/' + candidate : candidate;
      const hit = byLower.get(joined.toLowerCase());
      if (hit) return hit;
    }
  }
  return null;
}

export type ClosureResult = {
  paths: string[];
  missing: Reference[];
  unresolved: Reference[];
};

/**
 * Walks \input, \include, \includegraphics and bibliography references from the main file.
 * Files outside the closure are not part of the snapshot, so editing one cannot change the
 * PDF and therefore does not invalidate the cached result.
 */
export function buildReferenceClosure(
  mainFile: string,
  sources: Map<string, string>,
  availablePaths: string[],
): ClosureResult {
  const included = new Set<string>([mainFile]);
  const queue = [mainFile];
  const missing: Reference[] = [];
  const unresolved: Reference[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const source = sources.get(current);
    if (source === undefined) continue;
    for (const reference of extractReferences(current, source)) {
      const resolved = resolveReference(reference, availablePaths);
      if (!resolved) {
        const raw = reference.raw.replace(/\\/g, '/');
        if (raw.startsWith('/') || raw.split('/').includes('..')) unresolved.push(reference);
        else missing.push(reference);
        continue;
      }
      if (!included.has(resolved)) {
        included.add(resolved);
        if (sources.has(resolved)) queue.push(resolved);
      }
    }
  }

  return { paths: [...included].sort(), missing, unresolved };
}

export function canonicalManifest(manifest: SnapshotManifest): string {
  return JSON.stringify({
    version: manifest.version,
    documentId: manifest.documentId,
    userId: manifest.userId,
    mainFile: manifest.mainFile,
    compiler: {
      engine: manifest.compiler.engine,
      engineVersion: manifest.compiler.engineVersion,
      mainFile: manifest.compiler.mainFile,
      options: manifest.compiler.options,
    },
    files: manifest.files
      .map((file) => ({ path: file.path, checksum: file.checksum, revision: file.revision }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  });
}

export function snapshotDigest(manifest: SnapshotManifest, hash: (value: string) => string): string {
  return hash(canonicalManifest(manifest));
}

/** Guards against two workspace files that differ only by case resolving to one target. */
export function findAmbiguousPaths(paths: string[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    groups.set(key, [...(groups.get(key) || []), path]);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

export function isLikelyTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return !IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export { pathsCollide };
