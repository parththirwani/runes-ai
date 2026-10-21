import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/src/lib/db";
import { withAuth } from "@/src/lib/withAuth";
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

async function findOwnedMarkdownDocument(slug: string, userId: string): Promise<OwnedResult> {
  const document = await prisma.document.findFirst({
    where: { slug, userId },
    select: { id: true, format: true },
  });
  if (!document) return { kind: 'missing' };
  if (document.format !== "MARKDOWN") {
    return { kind: 'error', response: NextResponse.json({ message: "Assets are only supported for Markdown documents" }, { status: 400 }) };
  }
  return { kind: 'ok', document };
}

/* LIST assets for a Markdown document */
export const GET = withAuth(async (req, session, context) => {
  try {
    const { slug } = await context.params;
    const owned = await findOwnedMarkdownDocument(slug, session.user.id);
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
    const owned = await findOwnedMarkdownDocument(slug, session.user.id);
    if (owned.kind === "error") return owned.response;
    if (owned.kind === "missing") return NextResponse.json({ message: "Document not found" }, { status: 404 });

    const form = await req.formData().catch(() => null);
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

    const existing = await prisma.documentAsset.findMany({
      where: { documentId: owned.document.id },
      select: { size: true },
    });
    if (existing.length >= MAX_ASSETS_PER_DOCUMENT) {
      return NextResponse.json({ message: `At most ${MAX_ASSETS_PER_DOCUMENT} assets per document` }, { status: 409 });
    }
    const total = existing.reduce((sum, row) => sum + row.size, 0);
    if (total + bytes.length > MAX_TOTAL_ASSET_BYTES) {
      return NextResponse.json({ message: "Document asset storage limit reached" }, { status: 409 });
    }

    const checksum = createHash("sha256").update(bytes).digest("hex");
    const upserted = await prisma.documentAsset.upsert({
      where: { documentId_path: { documentId: owned.document.id, path: normalized.path } },
      create: { documentId: owned.document.id, path: normalized.path, mediaType, size: bytes.length, checksum, bytes },
      update: { mediaType, size: bytes.length, checksum, bytes },
    });

    return NextResponse.json(
      { asset: { id: upserted.id, path: upserted.path, mediaType: upserted.mediaType, size: upserted.size, url: `/api/document/${slug}/assets/${upserted.path}` } },
      { status: 201 }
    );
  } catch {
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
