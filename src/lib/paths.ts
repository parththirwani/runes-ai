// Single source of truth for navigation destinations used by CTAs and links.
// Keeping these in one module is what stops marketing labels and real routes
// from drifting apart again (see ui-revamp-plan.md, section 1).

export const LANDING_PATH = "/";
export const SIGN_IN_PATH = "/signin";
export const START_PATH = "/start";
export const DOCUMENTS_PATH = "/document";
// `ref` is a document id for every new link. A bare slug is only accepted for links written
// before ids were adopted; the server resolves it author-scoped for exactly that legacy traffic.
export const DOCUMENT_PATH = (ref: string) => `${DOCUMENTS_PATH}/${ref}`;
export const FEATURES_ANCHOR = "/#features";
export const HOW_IT_WORKS_ANCHOR = "/#how-it-works";

export type CreateFormat = "MARKDOWN" | "LATEX";

export function createDocumentPath(format: CreateFormat): string {
  return `${DOCUMENTS_PATH}?create=${format}`;
}

const MAX_REDIRECT_LENGTH = 2_048;

/**
 * Only same-site absolute paths may be used as post-sign-in destinations.
 * Rejects protocol-relative URLs (`//evil.test`), backslash tricks, embedded
 * schemes, whitespace and control characters.
 */
export function isSafeRedirect(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_REDIRECT_LENGTH) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return false;
  if (/^\/[^/?#]*[:]/.test(value)) return false;
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  return true;
}

export function resolveRedirect(value: unknown, fallback: string = DOCUMENTS_PATH): string {
  return isSafeRedirect(value) ? value : fallback;
}

/** Start writing has a format choice before opening the document dialog. */
export function startWritingPath(): string {
  return START_PATH;
}

/** Sign-in href that remembers where the user was heading, when it is safe. */
export function signInPath(next?: string | null): string {
  if (!isSafeRedirect(next) || next === DOCUMENTS_PATH || next === SIGN_IN_PATH) {
    return SIGN_IN_PATH;
  }
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(next)}`;
}
