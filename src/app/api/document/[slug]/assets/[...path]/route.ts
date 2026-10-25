import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { openReadableDocument, openWritableDocument } from "@/src/lib/document-lookup";
import { assetMediaTypeFor, normalizeAssetPath } from "@/src/lib/markdown-assets";

type Ctx = { params: Promise<{ slug: string; path: string | string[] }> };

function joinParamsPath(raw: unknown): string {
  // Next passes catch-all params as string[]; withAuth types them as string.
  if (Array.isArray(raw)) return raw.join("/");
  return typeof raw === "string" ? raw : "";
}

type ResolveResult =
  | { kind: 'response'; response: NextResponse }
  | { kind: 'ok'; document: { id: string; format: string }; asset: { id: string; path: string; mediaType: string; size: number; bytes: Uint8Array } };

/** Serving bytes uses read intent; deleting a byte uses write intent. */
async function resolve(session: { user: { id: string } }, context: Ctx, intent: 'read' | 'write'): Promise<ResolveResult> {
  const params = await context.params as unknown as { slug: string; path: string | string[] };
  const { slug } = params;
  const rawPath = joinParamsPath(params.path);

  const access = intent === 'write'
    ? await openWritableDocument(session.user.id, slug)
    : await openReadableDocument(session.user.id, slug);
  if (!access) {
    return { kind: 'response', response: NextResponse.json({ message: "Not found" }, { status: 404 }) };
  }
  const document = { id: access.document.id, format: access.document.format };
  const normalized = normalizeAssetPath(rawPath);
  if (!normalized.ok) {
    return { kind: 'response', response: NextResponse.json({ message: normalized.error }, { status: 400 }) };
  }
  const asset = await prisma.documentAsset.findUnique({
    where: { documentId_path: { documentId: document.id, path: normalized.path } },
  });
  if (!asset) {
    return { kind: 'response', response: NextResponse.json({ message: "Not found" }, { status: 404 }) };
  }
  return { kind: 'ok', document, asset };
}

/* Serve asset bytes — authenticated, ownership-checked, no-store. */
export const GET = withAuth(async (_req, session, context: Ctx) => {
  try {
    const result = await resolve(session as never, context as never, 'read');
    if (result.kind === "response") return result.response;

    const mediaType = assetMediaTypeFor(result.asset.path);
    if (!mediaType || mediaType !== result.asset.mediaType) {
      return NextResponse.json({ message: "Not found" }, { status: 404 });
    }
    const body = new Uint8Array(result.asset.bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": mediaType,
        "Content-Length": String(result.asset.size),
        "Content-Disposition": `inline; filename="${result.asset.path.split("/").pop()}"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    console.error("[ASSET_GET_ERROR] Request failed");
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});

/* Delete an asset (also expires with the document via cascade). */
export const DELETE = withAuth(async (_req, session, context: Ctx) => {
  try {
    const result = await resolve(session as never, context as never, 'write');
    if (result.kind === "response") return result.response;

    await prisma.documentAsset.delete({ where: { id: result.asset.id } });
    return NextResponse.json({ message: "Asset deleted" });
  } catch {
    console.error("[ASSET_DELETE_ERROR] Request failed");
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});
