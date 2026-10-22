// Workspace path validation and normalization.
//
// Every path that reaches the database or a compile directory passes through
// normalizeWorkspacePath. It only ever returns a relative POSIX path made of safe
// segments, so callers can join it onto a job directory without escaping it.

import pathModule from 'path';

export const MAX_PATH_LENGTH = 300;
export const MAX_PATH_DEPTH = 12;
export const MAX_SEGMENT_LENGTH = 100;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 1024 * 1024;
export const MAX_FILES_PER_WORKSPACE = 500;
export const MAX_WORKSPACE_BYTES = 50 * 1024 * 1024;

export const TEX_EXTENSIONS = ['.tex', '.sty', '.cls'];
export const BIB_EXTENSIONS = ['.bib'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.eps'];
export const OTHER_ALLOWED_EXTENSIONS = ['.txt'];

export const ALLOWED_EXTENSIONS = [
  ...TEX_EXTENSIONS,
  ...BIB_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...OTHER_ALLOWED_EXTENSIONS,
];

export type WorkspaceFileKind = 'tex' | 'bib' | 'image' | 'other';

// Segments must look like ordinary file names: letters, numbers, spaces, dot, dash,
// underscore and plus. Anything else (including a bare dot or dot-dot) is refused.
const SAFE_SEGMENT = /^[\p{L}\p{N}][\p{L}\p{N} ._+-]*$/u;

export function kindForPath(filePath: string): WorkspaceFileKind {
  const lower = filePath.toLowerCase();
  if (TEX_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'tex';
  if (BIB_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'bib';
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'image';
  return 'other';
}

export function isSupportedExtension(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// Written with code points instead of escape sequences so the source stays plain ASCII.
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code === 0xfeff) return true;
  }
  return false;
}

export class WorkspacePathError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkspacePathError';
    this.status = status;
  }
}

/**
 * Converts a user supplied path into a canonical relative workspace path.
 * Throws WorkspacePathError for anything that must not be stored or materialized.
 */
export function normalizeWorkspacePath(input: unknown, field = 'path'): string {
  if (typeof input !== 'string') throw new WorkspacePathError(field + ' must be a string');

  const raw = input.normalize('NFKC').trim();
  if (raw.length === 0) throw new WorkspacePathError(field + ' is required');
  if (raw.length > MAX_PATH_LENGTH) throw new WorkspacePathError(field + ' is too long');
  if (hasControlCharacter(raw)) throw new WorkspacePathError(field + ' contains a control character');

  // Backslashes are how Windows paths and some LaTeX tools write directories. Treating
  // them as separators stops a backslash traversal from slipping past the slash checks.
  const withSlashes = raw.replace(/\\/g, '/');

  if (withSlashes.startsWith('/') || /^[a-zA-Z]:\//.test(withSlashes)) {
    throw new WorkspacePathError(field + ' must be a relative path');
  }
  if (withSlashes.includes('//')) throw new WorkspacePathError(field + ' contains an empty path segment');
  if (withSlashes.endsWith('/')) throw new WorkspacePathError(field + ' must name a file');

  const segments = withSlashes.split('/');
  if (segments.length > MAX_PATH_DEPTH) throw new WorkspacePathError(field + ' is nested too deeply');

  const clean: string[] = [];
  for (const segmentRaw of segments) {
    // NFKC already folded full-width dots and similar look-alikes onto '.' or '..'.
    if (segmentRaw.length === 0) throw new WorkspacePathError(field + ' contains an empty path segment');
    if (segmentRaw.length > MAX_SEGMENT_LENGTH) throw new WorkspacePathError(field + ' segment is too long');
    if (segmentRaw === '.' || segmentRaw === '..') throw new WorkspacePathError(field + ' cannot contain . or ..');
    if (!SAFE_SEGMENT.test(segmentRaw)) {
      throw new WorkspacePathError(field + ' contains unsupported characters: ' + segmentRaw);
    }
    if (segmentRaw !== segmentRaw.trim() || segmentRaw.endsWith('.')) {
      throw new WorkspacePathError(field + ' segments cannot end with a space or a dot');
    }
    clean.push(segmentRaw);
  }

  const normalized = clean.join('/');
  if (normalized.startsWith('/') || normalized.includes('../') || normalized === '..') {
    throw new WorkspacePathError(field + ' escapes the workspace');
  }
  return normalized;
}

export function assertSafeWorkspacePath(input: unknown, field = 'path'): string {
  const normalized = normalizeWorkspacePath(input, field);
  if (!isSupportedExtension(normalized)) {
    throw new WorkspacePathError('Unsupported file type for ' + normalized, 415);
  }
  return normalized;
}

/** Joins a workspace path onto a base directory and proves the result stays inside it. */
export function resolveInsideDirectory(baseDir: string, filePath: string): string {
  const normalized = normalizeWorkspacePath(filePath);
  const base = pathModule.resolve(baseDir);
  const resolved = pathModule.resolve(base, normalized);
  if (resolved !== base && !resolved.startsWith(base + pathModule.sep)) {
    throw new WorkspacePathError(normalized + ' escapes the compile directory');
  }
  return resolved;
}

export function parentDirectory(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

export function baseName(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}

export function stripExtension(filePath: string): string {
  const name = baseName(filePath);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

export function withExtension(filePath: string, extension: string): string {
  const dir = parentDirectory(filePath);
  const stem = stripExtension(filePath);
  const name = stem.length === 0 ? baseName(filePath) : stem;
  return dir ? dir + '/' + name + extension : name + extension;
}

/**
 * Two paths are considered colliding when they differ only by case or Unicode form.
 * TeX and case-insensitive filesystems would treat them as the same file, which makes
 * a second row that differs only by case an ambiguous include target.
 */
export function pathsCollide(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export type TreeNode = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: TreeNode[];
};

/** Builds a real folder/file tree from flat workspace paths. */
export function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const directories = new Map<string, TreeNode>();

  const ensureDirectory = (folderSegments: string[]): TreeNode[] => {
    let level = root;
    let prefix = '';
    for (const segment of folderSegments) {
      prefix = prefix ? prefix + '/' + segment : segment;
      let node = directories.get(prefix);
      if (!node) {
        node = { name: segment, path: prefix, type: 'directory', children: [] };
        directories.set(prefix, node);
        level.push(node);
      }
      level = node.children!;
    }
    return level;
  };

  for (const filePath of [...paths].sort()) {
    const segments = filePath.split('/');
    const level = ensureDirectory(segments.slice(0, -1));
    level.push({ name: segments[segments.length - 1], path: filePath, type: 'file' });
  }

  const sortLevel = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) if (node.children) sortLevel(node.children);
    return nodes;
  };

  return sortLevel(root);
}
