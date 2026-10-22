// Owned local asset store rules for Markdown images.
//
// Until the multi-file workspace branch (compile-workspace-plan.md) merges,
// Markdown documents own a flat, validated set of image assets. Every asset
// lives at a normalized relative path under the document — this maps 1:1 to
// (documentId, normalizedPath) rows in the planned workspace file model, so
// no separate incompatible store is introduced.
//
// Rules: relative POSIX paths only, no absolute paths, no "..", no
// backslashes, no hidden/dot segments, no symlinks (there is no filesystem
// backing), bounded size/count/type.

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;          // 5 MiB per file
export const MAX_ASSETS_PER_DOCUMENT = 25;
export const MAX_TOTAL_ASSET_BYTES = 20 * 1024 * 1024;   // 20 MiB per document
export const MAX_ASSET_PATH_LENGTH = 128;

export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

// SVG is intentionally excluded: SVG can embed scripts and external refs.

export type AssetPathResult = { ok: true; path: string } | { ok: false; error: string };

export function normalizeAssetPath(rawPath: string): AssetPathResult {
  if (typeof rawPath !== 'string') return { ok: false, error: 'Asset path must be a string' };
  const path = rawPath.trim();
  if (path.length === 0) return { ok: false, error: 'Asset path is empty' };
  if (path.length > MAX_ASSET_PATH_LENGTH) return { ok: false, error: `Asset path exceeds ${MAX_ASSET_PATH_LENGTH} characters` };
  if (path.includes('\\')) return { ok: false, error: 'Asset path must use forward slashes' };
  if (path.startsWith('/')) return { ok: false, error: 'Asset path must be relative' };
  if (path.includes('://')) return { ok: false, error: 'Asset path must not contain a URL scheme' };
  if (/^[A-Za-z]:/.test(path)) return { ok: false, error: 'Asset path must not be a drive path' };
  if (path.includes('%')) return { ok: false, error: 'Asset path must not contain percent escapes' };
  const segments = path.split('/');
  if (segments.length > 4) return { ok: false, error: 'Asset path may have at most 4 segments' };
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') {
      return { ok: false, error: 'Asset path contains an empty, "." or ".." segment' };
    }
    if (segment.startsWith('.')) return { ok: false, error: 'Asset path segments must not start with "."' };
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(segment)) {
      return { ok: false, error: `Asset path segment contains unsupported characters: ${segment}` };
    }
  }
  const last = segments[segments.length - 1];
  const extMatch = last.match(/\.([A-Za-z0-9]+)$/);
  if (!extMatch) return { ok: false, error: 'Asset path must end with a file extension' };
  const ext = extMatch[1].toLowerCase();
  if (!(ext in ALLOWED_IMAGE_TYPES)) {
    return { ok: false, error: `Unsupported asset type ".${ext}" (allowed: ${Object.keys(ALLOWED_IMAGE_TYPES).join(', ')})` };
  }
  return { ok: true, path: segments.map((s) => s.toLowerCase().replace(/\s+/g, '-')).join('/') };
}

export function assetMediaTypeFor(path: string): string | null {
  const extMatch = path.match(/\.([A-Za-z0-9]+)$/);
  if (!extMatch) return null;
  return ALLOWED_IMAGE_TYPES[extMatch[1].toLowerCase()] ?? null;
}
