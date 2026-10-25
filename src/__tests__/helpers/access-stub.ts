// Test double for the capability service, for suites whose subject is NOT access control.
//
// The real service (src/lib/access.ts) resolves a document through workspace rows, grants and
// team memberships. Route and file-service fixtures here predate that model and describe one
// author per document, so this stub resolves the same way those tests always have: through
// `document.findFirst({ slug|id, userId })`. Unowned documents still resolve to nothing, so the
// existing 404 expectations keep proving something.
//
// The permission matrix itself — shared readers, workspace grants, team roles, removed members,
// admin inspection — is covered by src/__tests__/access-policy.test.ts against the real policy,
// and must not be re-verified through this stub.

import type { DocumentAccess } from "@/src/lib/access";
import type { DocumentCapabilities } from "@/src/lib/access-policy";

type StubRow = {
  id: string;
  slug?: string;
  title?: string;
  format?: string;
  userId: string;
  workspaceId?: string | null;
};

type StubClient = {
  document: {
    findFirst: (args: { where: Record<string, unknown> }) => Promise<StubRow | null>;
  };
};

export function authorCapabilities(authorId: string): DocumentCapabilities {
  return {
    canRead: true,
    canEdit: true,
    canShare: true,
    canMove: true,
    canDelete: true,
    isAdmin: false,
    authorId,
    access: "author",
  };
}

function toAccess(row: StubRow): DocumentAccess {
  return {
    document: {
      id: row.id,
      slug: row.slug ?? "",
      title: row.title ?? "",
      format: row.format === "MARKDOWN" ? "MARKDOWN" : "LATEX",
      userId: row.userId,
      workspaceId: row.workspaceId ?? "workspace-legacy",
    },
    capabilities: authorCapabilities(row.userId),
  };
}

async function bySlug(client: StubClient, userId: string, slug: string): Promise<DocumentAccess | null> {
  const row = await client.document.findFirst({ where: { slug, userId } });
  return row ? toAccess(row) : null;
}

async function byId(client: StubClient, userId: string, id: string): Promise<DocumentAccess | null> {
  const row = await client.document.findFirst({ where: { id, userId } });
  return row ? toAccess(row) : null;
}

/**
 * Spread over the real module inside `vi.mock("@/src/lib/access", ...)`. `AccessError`,
 * `accessErrorResponse`, `readableWhere` and `findAuthorOnlyDocument` come from the real module
 * so error mapping and status codes stay the production ones.
 */
export function ownerOnlyAccessStub() {
  return {
    getDocumentAccess: async (client: StubClient, userId: string, documentId: string) => byId(client, userId, documentId),
    getDocumentAccessBySlug: async (client: StubClient, userId: string, slug: string) => bySlug(client, userId, slug),
    requireDocumentRead: (client: StubClient, userId: string, documentId: string) => requireAccess(byId(client, userId, documentId)),
    requireDocumentEdit: (client: StubClient, userId: string, documentId: string) => requireAccess(byId(client, userId, documentId)),
    requireDocumentReadBySlug: (client: StubClient, userId: string, slug: string) => requireAccess(bySlug(client, userId, slug)),
    requireDocumentEditBySlug: (client: StubClient, userId: string, slug: string) => requireAccess(bySlug(client, userId, slug)),
    isAppAdmin: async () => false,
    requireAppAdmin: async () => undefined,
    capabilitiesForMany: async (_client: StubClient, _userId: string, documentIds: string[]) =>
      new Map(documentIds.map((id) => [id, authorCapabilities("author-1")])),
  };
}

async function requireAccess(pending: Promise<DocumentAccess | null>): Promise<DocumentAccess> {
  const access = await pending;
  if (!access) {
    // The real class is re-thrown by the caller module's own import, so routes keep mapping the
    // status through the production `accessErrorResponse`.
    const { AccessError } = await import("@/src/lib/access");
    throw new AccessError("Document not found", 404, "not-found");
  }
  return access;
}
