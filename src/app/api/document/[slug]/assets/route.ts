import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
import { openReadableDocument, openWritableDocument } from "@/src/lib/document-lookup";
import {
  MAX_ASSET_BYTES,
  MAX_ASSETS_PER_DOCUMENT,
  MAX_TOTAL_ASSET_BYTES,
  assetMediaTypeFor,
  normalizeAssetPath,
} from "@/src/lib/markdown-assets";

type OwnedResult =
  | { kind: 'missing' }
  | { kind: 'error'; response: NextResponse }
  | { kind: 'ok'; document: { id: string; format: string } };

class AssetQuotaError extends Error {}

const MAX_UPLOAD_BODY_BYTES = MAX_ASSET_BYTES + 64 * 1024;

async function readBoundedForm(req: Request): Promise<FormData | 'too-large' | null> {
  const statedLength = Number(req.headers.get('content-length'));
  if (statedLength > MAX_UPLOAD_BODY_BYTES) return 'too-large';
  const contentType = req.headers.get('content-type');
  if (!contentType?.toLowerCase().startsWith('multipart/form-data;')) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_UPLOAD_BODY_BYTES) {
      await reader.cancel();
      return 'too-large';
    }
    chunks.push(Buffer.from(value));
  }
  return new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: Buffer.concat(chunks),
  }).formData().catch(() => null);
}

// Read routes accept anyone the capability service says may read the document; mutation routes
// require write intent, which is the author alone.
async function findMarkdownDocument(slug: string, userId: string, intent: 'read' | 'write'): Promise<OwnedResult> {
  const access = intent === 'write'
    ? await openWritableDocument(userId, slug)
    : await openReadableDocument(userId, slug);
  if (!access) return { kind: 'missing' };
  if (access.document.format !== "MARKDOWN") {
    return { kind: 'error', response: NextResponse.json({ message: "Assets are only supported for Markdown documents" }, { status: 400 }) };
  }
  return { kind: 'ok', document: { id: access.document.id, format: access.document.format } };
}

/* LIST assets for a Markdown document */
export const GET = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const owned = await findMarkdownDocument(slug, session.user.id, 'read');
    if (owned.kind === "error") return owned.response;
    if (owned.kind === "missing") return NextResponse.json({ message: "Document not found" }, { status: 404 });

    const assets = await prisma.documentAsset.findMany({
      where: { documentId: owned.document.id },
      select: { id: true, path: true, mediaType: true, size: true, checksum: true, updatedAt: true },
      orderBy: { path: "asc" },
    });
    return NextResponse.json({
      assets: assets.map((a) => ({ ...a, url: `/api/document/${slug}/assets/${a.path}` })),
    });
  } catch {
    console.error("[ASSETS_LIST_ERROR] Request failed");
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});

/* UPLOAD one image asset (multipart form: file, optional path) */
export const POST = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const owned = await findMarkdownDocument(slug, session.user.id, 'write');
    if (owned.kind === "error") return owned.response;
    if (owned.kind === "missing") return NextResponse.json({ message: "Upload requires document edit access" }, { status: 404 });

    const form = await readBoundedForm(req);
    if (form === 'too-large') {
      return NextResponse.json({ message: 'Asset upload exceeds the request size limit' }, { status: 413 });
    }
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ message: "Multipart field 'file' is required" }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ message: "Asset file is empty" }, { status: 400 });
    if (file.size > MAX_ASSET_BYTES) {
      return NextResponse.json({ message: `Asset exceeds the ${MAX_ASSET_BYTES / (1024 * 1024)} MiB limit` }, { status: 413 });
    }

    const requestedPath = (form?.get("path") as string | null) ?? file.name;
    const normalized = normalizeAssetPath(requestedPath ?? "");
    if (!normalized.ok) {
      return NextResponse.json({ message: normalized.error }, { status: 400 });
    }
    const mediaType = assetMediaTypeFor(normalized.path);
    if (!mediaType) return NextResponse.json({ message: "Unsupported asset type" }, { status: 400 });

    const bytes = Buffer.from(await file.arrayBuffer());
    // Trust the extension only when the content sniff agrees.
    if (!magicMatches(normalized.path, bytes)) {
      return NextResponse.json({ message: "File content does not match its image extension" }, { status: 400 });
    }

    const checksum = createHash("sha256").update(bytes).digest("hex");
    // Count and write in one serializable transaction. Concurrent uploads
    // to different paths must not each pass the same quota snapshot.
    const upserted = await prisma.$transaction(async (tx) => {
      const existing = await tx.documentAsset.findMany({
        where: { documentId: owned.document.id },
        select: { path: true, size: true },
      });
      const replacing = existing.find((row) => row.path === normalized.path);
      if (!replacing && existing.length >= MAX_ASSETS_PER_DOCUMENT) {
        throw new AssetQuotaError(`At most ${MAX_ASSETS_PER_DOCUMENT} assets per document`);
      }
      const total = existing.reduce((sum, row) => sum + row.size, 0) - (replacing?.size ?? 0);
      if (total + bytes.length > MAX_TOTAL_ASSET_BYTES) {
        throw new AssetQuotaError("Document asset storage limit reached");
      }
      return tx.documentAsset.upsert({
        where: { documentId_path: { documentId: owned.document.id, path: normalized.path } },
        create: { documentId: owned.document.id, path: normalized.path, mediaType, size: bytes.length, checksum, bytes },
        update: { mediaType, size: bytes.length, checksum, bytes },
      });
    }, { isolationLevel: "Serializable" });

    return NextResponse.json(
      { asset: { id: upserted.id, path: upserted.path, mediaType: upserted.mediaType, size: upserted.size, url: `/api/document/${slug}/assets/${upserted.path}` } },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof AssetQuotaError) {
      return NextResponse.json({ message: error.message }, { status: 409 });
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2034") {
      return NextResponse.json({ message: "Concurrent upload conflict. Please retry." }, { status: 409 });
    }
    console.error("[ASSET_UPLOAD_ERROR] Request failed");
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
});

function magicMatches(path: string, bytes: Buffer): boolean {
  const head = bytes.subarray(0, 12);
  const hex = Buffer.from(head).toString("hex");
  if (path.endsWith(".png")) return hex.startsWith("89504e470d0a1a0a");
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return hex.startsWith("ffd8ff");
  if (path.endsWith(".gif")) return hex.startsWith("474946383761") || hex.startsWith("474946383961");
  if (path.endsWith(".webp")) return hex.startsWith("52494646") && bytes.length >= 12 && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
