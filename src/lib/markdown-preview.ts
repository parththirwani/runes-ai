// URL policy for the rendered reading preview. Pure and tested.
//
// Links: http(s), mailto, and same-document fragments stay clickable.
// Images: only validated local asset URLs on our own document asset route —
// remote images show an unsupported-resource notice and are never fetched.
// javascript:, vbscript:, file:, data:, blob:, and scheme-relative URLs are
// always rejected.

const ASSET_URL = /^\/api\/document\/[A-Za-z0-9-]+\/assets\/[A-Za-z0-9._/%-]+$/;
const BLOCKED = /^\s*(javascript|vbscript|file|blob|about):/i;
const ALLOWED_LINK = /^(https?:|mailto:)/i;

function normalize(url: string): string {
  // Strip control characters so URL schemes cannot be hidden inside them.
  let out = '';
  for (const char of url) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += char;
  }
  return out.trim();
}

export function safePreviewUrl(url: string, kind: 'link' | 'image'): string | null {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2_000) return null;
  const target = normalize(url);
  if (!target || BLOCKED.test(target)) return null;
  if (/^data:/i.test(target)) return null;

  if (kind === 'image') {
    if (target.startsWith('//')) return null; // scheme-relative fetch
    return ASSET_URL.test(target) ? target : null;
  }

  if (target.startsWith('#')) return target;
  if (target.startsWith('//')) return null;
  if (target.startsWith('/') || target.startsWith('./') || target.startsWith('../')) return null;
  return ALLOWED_LINK.test(target) ? target : null;
}

export function isLocalAssetUrl(url: string): boolean {
  return safePreviewUrl(url, 'image') !== null;
}
