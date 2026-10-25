// Resolves the document a request is about, then attaches the caller's capabilities to it.
//
// Two identifier shapes are accepted on purpose:
//
//   * A document id (uuid) is the canonical form for every new flow and for shared viewers.
//   * A bare slug keeps every pre-existing author link working. It is resolved through the
//     author-scoped lookup only, so a shared recipient can never guess a slug and reach a
//     document they were not invited to; viewers always arrive by id.
//
// Callers pass an explicit intent. Asking for `write` never falls back to a read grant.

import { prisma } from './db';
import { getDocumentAccess, type DocumentAccess } from './access';

export type AccessIntent = 'read' | 'write';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function looksLikeDocumentId(ref: string): boolean {
  return UUID_PATTERN.test(ref);
}

function allowed(access: DocumentAccess, intent: AccessIntent): DocumentAccess | null {
  if (intent === 'write') return access.capabilities.canEdit ? access : null;
  return access.capabilities.canRead ? access : null;
}

/**
 * Returns the document plus the caller's capabilities, or null when the document does not exist
 * or the caller may not use it for this intent. Null is the correct answer for both cases so
 * routes can return one non-revealing 404 instead of confirming that an id exists.
 */
export async function openDocument(
  userId: string,
  ref: string,
  intent: AccessIntent,
): Promise<DocumentAccess | null> {
  const trimmed = (ref ?? '').trim();
  if (trimmed.length === 0) return null;

  if (looksLikeDocumentId(trimmed)) {
    const access = await getDocumentAccess(userId, trimmed);
    return access ? allowed(access, intent) : null;
  }

  const authored = await prisma.document.findFirst({
    where: { slug: trimmed, userId },
    // Two personal workspaces may legitimately hold the same URL segment. Preferring the default
    // workspace keeps an old link pointing at the document the author most likely meant.
    orderBy: [{ workspace: { isDefault: 'desc' } }, { createdAt: 'asc' }],
  });
  if (!authored) return null;
  const access = await getDocumentAccess(userId, authored.id);
  return access ? allowed(access, intent) : null;
}

/** Read-intent variant for callers that only ever read. */
export function openReadableDocument(userId: string, ref: string) {
  return openDocument(userId, ref, 'read');
}

/** Write-intent variant: author only, re-derived on every call. */
export function openWritableDocument(userId: string, ref: string) {
  return openDocument(userId, ref, 'write');
}
