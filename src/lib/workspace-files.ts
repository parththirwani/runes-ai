// Workspace file service: access, limits, revisions, and legacy-document migration.
//
// Every entry point takes the authenticated user id and resolves the document through the
// central capability service (src/lib/access.ts), so a route cannot accidentally read or
// write another user's workspace by guessing an id or a path. Read intent and write intent
// are separate helpers on purpose: a viewer may read the same tree the author sees, but every
// mutation path re-checks author access immediately before it writes.
//
// Terminology note kept from the plan: "workspace" in this file means the bundle of FILES
// INSIDE ONE document (WorkspaceFile). The document COLLECTION model is `Workspace` and lives
// in src/lib/workspaces.ts and src/lib/access.ts.

import { prisma } from './db';
import { checksum, assetKey, putBytes, getBytes } from './storage';
import { AccessError, getDocumentAccessBySlug, type DocumentAccess } from './access';
import {
  MAX_FILES_PER_WORKSPACE,
  MAX_FILE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_WORKSPACE_BYTES,
  WorkspacePathError,
  assertSafeWorkspacePath,
  buildTree,
  kindForPath,
  pathsCollide,
  type TreeNode,
} from './workspace-paths';

export const DEFAULT_MAIN_FILE = 'main.tex';
export const LEGACY_MAIN_FILE = DEFAULT_MAIN_FILE;

export class WorkspaceError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkspaceError';
    this.status = status;
  }
}

export type WorkspaceFileRecord = {
  id: string;
  path: string;
  kind: 'tex' | 'bib' | 'image' | 'other';
  mimeType: string | null;
  sizeBytes: number;
  checksum: string;
  revision: number;
  updatedAt: Date;
};

export type WorkspaceFileContent = WorkspaceFileRecord & { content: string | null; binary: boolean };

export type WorkspaceTree = {
  document: {
    id: string;
    slug: string;
    title: string;
    format: 'LATEX' | 'MARKDOWN';
    mainFilePath: string;
    updatedAt: Date;
    authorId: string;
  };
  files: WorkspaceFileRecord[];
  tree: TreeNode[];
  capabilities: DocumentAccess['capabilities'];
  /**
   * Source of the main file when the document has not been migrated to files yet. A reader
   * must see the same text the author sees, but must never trigger the migration write.
   */
  legacyMainSource: string | null;
};

const TEXT_KINDS = new Set(['tex', 'bib', 'other']);

const publicFile = (file: {
  id: string; path: string; kind: 'tex' | 'bib' | 'image' | 'other'; mimeType: string | null;
  sizeBytes: number; checksum: string; revision: number; updatedAt: Date;
}): WorkspaceFileRecord => ({
  id: file.id,
  path: file.path,
  kind: file.kind,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  checksum: file.checksum,
  revision: file.revision,
  updatedAt: file.updatedAt,
});

/**
 * Resolves a legacy slug URL for reading. Returns null when the caller cannot read the
 * document; an ambiguous shared slug surfaces as AccessError from the access service.
 */
export async function resolveForRead(userId: string, slug: string): Promise<DocumentAccess | null> {
  return getDocumentAccessBySlug(prisma, userId, slug);
}

/**
 * Resolves a legacy slug URL for writing. Author access only, and always re-run inside the
 * mutation itself rather than cached from an earlier read.
 */
export async function resolveForWrite(userId: string, slug: string): Promise<DocumentAccess | null> {
  const access = await getDocumentAccessBySlug(prisma, userId, slug);
  if (!access || !access.capabilities.canEdit) return null;
  return access;
}

/**
 * Creates the format's main file for documents that still only have the legacy content column.
 * Only ever called on an author path: a shared read must not write.
 */
export async function ensureDocumentMigrated(client: typeof prisma, documentId: string): Promise<void> {
  const fileCount = await client.workspaceFile.count({ where: { documentId } });
  if (fileCount > 0) return;

  const document = await client.document.findUnique({ where: { id: documentId }, select: { content: true, format: true } });
  const content = document?.content ?? '';
  const mainFile = document?.format === 'MARKDOWN' ? 'main.md' : DEFAULT_MAIN_FILE;

  await client.workspaceFile.create({
    data: {
      documentId,
      path: mainFile,
      kind: document?.format === 'MARKDOWN' ? 'other' : 'tex',
      mimeType: document?.format === 'MARKDOWN' ? 'text/markdown' : 'text/x-tex',
      sizeBytes: bytes_length(content),
      checksum: checksum(Buffer.from(content, 'utf-8')),
      revision: 1,
      content,
    },
  });
  await client.document.update({ where: { id: documentId }, data: { mainFilePath: mainFile } });
}

function bytes_length(content: string): number {
  return Buffer.from(content, 'utf-8').byteLength;
}

/** Author-only lookup, kept for callers that genuinely need ownership semantics. */
export async function getOwnedDocument(userId: string, slug: string) {
  const access = await resolveForWrite(userId, slug);
  if (!access) return null;
  return prisma.document.findUnique({ where: { id: access.document.id } });
}

export async function readWorkspaceTree(userId: string, slug: string): Promise<WorkspaceTree | null> {
  const access = await resolveForRead(userId, slug);
  if (!access) return null;

  // Migrating a legacy document writes rows, so only an author path may do it.
  if (access.capabilities.canEdit) {
    await ensureDocumentMigrated(prisma, access.document.id);
  }

  const currentDocument = await prisma.document.findUnique({ where: { id: access.document.id } });
  if (!currentDocument) return null;

  const files = await prisma.workspaceFile.findMany({
    where: { documentId: access.document.id },
    orderBy: { path: 'asc' },
  });

  const legacyMainSource =
    files.length === 0 ? currentDocument.content ?? '' : null;

  return {
    document: {
      id: currentDocument.id,
      slug: currentDocument.slug,
      title: currentDocument.title,
      format: currentDocument.format,
      mainFilePath: currentDocument.mainFilePath,
      updatedAt: currentDocument.updatedAt,
      authorId: currentDocument.userId,
    },
    files: files.map(publicFile),
    tree: buildTree(files.map((file) => file.path)),
    capabilities: access.capabilities,
    legacyMainSource,
  };
}

export async function readWorkspaceFile(userId: string, slug: string, rawPath: string): Promise<WorkspaceFileContent | null> {
  const access = await resolveForRead(userId, slug);
  if (!access) return null;
  if (access.capabilities.canEdit) await ensureDocumentMigrated(prisma, access.document.id);

  const path = assertSafeWorkspacePath(rawPath);
  const file = await prisma.workspaceFile.findUnique({
    where: { documentId_path: { documentId: access.document.id, path } },
  });
  if (file) return { ...publicFile(file), content: file.content, binary: !TEXT_KINDS.has(file.kind) };

  // A reader opening an unmigrated legacy document still gets its main source.
  if (path === DEFAULT_MAIN_FILE || path === 'main.md') {
    const document = await prisma.document.findUnique({ where: { id: access.document.id }, select: { content: true } });
    if (document?.content !== null && document?.content !== undefined) {
      const bytes = Buffer.from(document.content, 'utf-8');
      return {
        id: access.document.id,
        path,
        kind: path.endsWith('.md') ? 'other' : 'tex',
        mimeType: path.endsWith('.md') ? 'text/markdown' : 'text/x-tex',
        sizeBytes: bytes.byteLength,
        checksum: checksum(bytes),
        revision: 0,
        updatedAt: new Date(0),
        content: document.content,
        binary: false,
      };
    }
  }
  return null;
}

export async function readWorkspaceAsset(userId: string, slug: string, rawPath: string) {
  const access = await resolveForRead(userId, slug);
  if (!access) return null;
  const path = assertSafeWorkspacePath(rawPath);
  const file = await prisma.workspaceFile.findUnique({
    where: { documentId_path: { documentId: access.document.id, path } },
  });
  if (!file || !file.storageKey) return null;
  const bytes = await getBytes(file.storageKey);
  if (!bytes) throw new WorkspaceError('Stored asset is missing', 500);
  if (checksum(bytes) !== file.checksum) throw new WorkspaceError('Stored asset failed its checksum', 500);
  return { bytes, mimeType: file.mimeType || 'application/octet-stream', path: file.path };
}

async function loadWorkspaceTotals(client: typeof prisma, documentId: string) {
  const aggregate = await client.workspaceFile.aggregate({
    where: { documentId },
    _count: { _all: true },
    _sum: { sizeBytes: true },
  });
  return { count: aggregate._count._all, bytes: aggregate._sum.sizeBytes || 0 };
}

/** Shared checks for anything that stores bytes under a workspace path. */
async function assertCanStore(
  client: typeof prisma,
  documentId: string,
  path: string,
  sizeBytes: number,
  existing: { sizeBytes: number } | null,
) {
  if (sizeBytes > MAX_FILE_BYTES) {
    throw new WorkspaceError('File is larger than ' + Math.floor(MAX_FILE_BYTES / 1024 / 1024) + ' MB', 413);
  }
  if (kindForPath(path) !== 'image' && sizeBytes > MAX_TEXT_FILE_BYTES) {
    throw new WorkspaceError('Text file is larger than ' + Math.floor(MAX_TEXT_FILE_BYTES / 1024) + ' KB', 413);
  }

  const totals = await loadWorkspaceTotals(client, documentId);
  const projectedBytes = totals.bytes - (existing?.sizeBytes || 0) + sizeBytes;
  const projectedCount = existing ? totals.count : totals.count + 1;

  if (projectedCount > MAX_FILES_PER_WORKSPACE) {
    throw new WorkspaceError('Workspace cannot hold more than ' + MAX_FILES_PER_WORKSPACE + ' files', 413);
  }
  if (projectedBytes > MAX_WORKSPACE_BYTES) {
    throw new WorkspaceError('Workspace cannot exceed ' + Math.floor(MAX_WORKSPACE_BYTES / 1024 / 1024) + ' MB', 413);
  }
}

async function assertNoCollision(client: typeof prisma, documentId: string, path: string, excludeId?: string) {
  const files = await client.workspaceFile.findMany({ where: { documentId }, select: { id: true, path: true } });
  for (const file of files) {
    if (excludeId && file.id === excludeId) continue;
    if (file.path === path) continue;
    if (pathsCollide(file.path, path)) {
      throw new WorkspaceError('A file named ' + file.path + ' already exists; names cannot differ only by case', 409);
    }
  }
}

export type WriteResult = { file: WorkspaceFileRecord; created: boolean; unchanged: boolean };

/** Creates or updates a text file. baseRevision gives optimistic conflict detection. */
export async function writeTextFile(input: {
  userId: string;
  slug: string;
  rawPath: string;
  content: string;
  baseRevision?: number | null;
}): Promise<WriteResult | { conflict: WorkspaceFileRecord } | null> {
  // Re-checked here, at mutation time, not by the caller earlier.
  const access = await resolveForWrite(input.userId, input.slug);
  if (!access) return null;
  await ensureDocumentMigrated(prisma, access.document.id);

  const currentDocument = await prisma.document.findUnique({ where: { id: access.document.id } });
  if (!currentDocument) return null;

  const path = assertSafeWorkspacePath(input.rawPath);
  const kind = kindForPath(path);
  if (!TEXT_KINDS.has(kind)) throw new WorkspaceError('Use the upload endpoint for ' + path, 415);

  const bytes = Buffer.from(input.content, 'utf-8');
  const hash = checksum(bytes);
  const existing = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: currentDocument.id, path } } });

  // A save that writes the same bytes is a no-op. Bumping the revision here would change
  // the snapshot digest and force a full recompile of unchanged source after every autosave.
  if (existing && existing.checksum === hash && existing.kind === kind) {
    return { file: publicFile(existing), created: false, unchanged: true };
  }

  await assertCanStore(prisma, currentDocument.id, path, bytes.byteLength, existing);
  if (input.baseRevision !== undefined && input.baseRevision !== null) {
    if (existing && existing.revision !== input.baseRevision) {
      return { conflict: publicFile(existing) };
    }
  }

  if (!existing) await assertNoCollision(prisma, currentDocument.id, path);

  const isMain = pathsCollide(path, currentDocument.mainFilePath);
  const file = await prisma.workspaceFile.upsert({
    where: { documentId_path: { documentId: currentDocument.id, path } },
    create: {
      documentId: currentDocument.id,
      path,
      kind,
      mimeType: kind === 'tex' ? 'text/x-tex' : kind === 'bib' ? 'application/x-bibtex' : 'text/plain',
      sizeBytes: bytes.byteLength,
      checksum: hash,
      revision: 1,
      content: input.content,
    },
    update: {
      kind,
      sizeBytes: bytes.byteLength,
      checksum: hash,
      revision: { increment: 1 },
      content: input.content,
      storageKey: null,
    },
  });

  // Keep the legacy column pointing at the main source so old clients and rollback work.
  if (isMain) await prisma.document.update({ where: { id: currentDocument.id }, data: { content: input.content } });

  return { file: publicFile(file), created: !existing, unchanged: false };
}

export async function uploadFile(input: {
  userId: string;
  slug: string;
  rawPath: string;
  bytes: Buffer;
  mimeType?: string | null;
}): Promise<WorkspaceFileRecord | null> {
  const access = await resolveForWrite(input.userId, input.slug);
  if (!access) return null;
  await ensureDocumentMigrated(prisma, access.document.id);

  const currentDocument = await prisma.document.findUnique({ where: { id: access.document.id } });
  if (!currentDocument) return null;

  const path = assertSafeWorkspacePath(input.rawPath);
  const kind = kindForPath(path);
  if (input.bytes.byteLength === 0) throw new WorkspaceError('Uploaded file is empty', 400);

  const hash = checksum(input.bytes);
  const existing = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: currentDocument.id, path } } });
  if (existing && existing.checksum === hash) return publicFile(existing);

  await assertCanStore(prisma, currentDocument.id, path, input.bytes.byteLength, existing);
  if (!existing) await assertNoCollision(prisma, currentDocument.id, path);

  const extension = path.slice(path.lastIndexOf('.'));
  const storageKey = assetKey(currentDocument.id, hash, extension);
  await putBytes(storageKey, input.bytes);

  const isText = TEXT_KINDS.has(kind);
  const file = await prisma.workspaceFile.upsert({
    where: { documentId_path: { documentId: currentDocument.id, path } },
    create: {
      documentId: currentDocument.id,
      path,
      kind,
      mimeType: input.mimeType || (kind === 'tex' ? 'text/x-tex' : 'application/octet-stream'),
      sizeBytes: input.bytes.byteLength,
      checksum: hash,
      revision: 1,
      content: isText ? input.bytes.toString('utf-8') : null,
      storageKey,
    },
    update: {
      kind,
      sizeBytes: input.bytes.byteLength,
      checksum: hash,
      revision: { increment: 1 },
      content: isText ? input.bytes.toString('utf-8') : null,
      storageKey,
    },
  });

  if (pathsCollide(path, currentDocument.mainFilePath) && isText) {
    await prisma.document.update({ where: { id: currentDocument.id }, data: { content: input.bytes.toString('utf-8') } });
  }
  return publicFile(file);
}

export async function deleteFile(userId: string, slug: string, rawPath: string): Promise<'deleted' | 'notfound' | 'mainfile' | null> {
  const access = await resolveForWrite(userId, slug);
  if (!access) return null;
  await ensureDocumentMigrated(prisma, access.document.id);

  const currentDocument = await prisma.document.findUnique({ where: { id: access.document.id } });
  if (!currentDocument) return null;

  const path = assertSafeWorkspacePath(rawPath);
  if (pathsCollide(path, currentDocument.mainFilePath)) return 'mainfile';

  const existing = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: currentDocument.id, path } } });
  if (!existing) return 'notfound';
  await prisma.workspaceFile.delete({ where: { id: existing.id } });
  return 'deleted';
}

/** Moves or renames a file, keeping the main-file pointer in sync. */
export async function moveFile(input: {
  userId: string;
  slug: string;
  from: string;
  to: string;
}): Promise<{ file: WorkspaceFileRecord; mainFilePath: string } | 'notfound' | 'exists' | null> {
  const access = await resolveForWrite(input.userId, input.slug);
  if (!access) return null;
  await ensureDocumentMigrated(prisma, access.document.id);

  const currentDocument = await prisma.document.findUnique({ where: { id: access.document.id } });
  if (!currentDocument) return null;

  const from = assertSafeWorkspacePath(input.from, 'from');
  const to = assertSafeWorkspacePath(input.to, 'to');
  if (from === to) {
    const same = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: currentDocument.id, path: from } } });
    return same ? { file: publicFile(same), mainFilePath: currentDocument.mainFilePath } : 'notfound';
  }

  const source = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: currentDocument.id, path: from } } });
  if (!source) return 'notfound';
  const target = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: currentDocument.id, path: to } } });
  if (target) return 'exists';
  await assertNoCollision(prisma, currentDocument.id, to, source.id);

  // The extension decides the kind; binary payloads keep their stored bytes and key.
  const kind = kindForPath(to);
  const file = await prisma.workspaceFile.update({
    where: { id: source.id },
    data: { path: to, kind, revision: { increment: 1 } },
  });

  let mainFilePath = currentDocument.mainFilePath;
  if (pathsCollide(from, currentDocument.mainFilePath)) {
    mainFilePath = to;
    await prisma.document.update({ where: { id: currentDocument.id }, data: { mainFilePath: to, content: file.content } });
  }
  return { file: publicFile(file), mainFilePath };
}

export async function setMainFile(userId: string, slug: string, rawPath: string) {
  const access = await resolveForWrite(userId, slug);
  if (!access) return null;
  await ensureDocumentMigrated(prisma, access.document.id);

  const path = assertSafeWorkspacePath(rawPath);
  if (kindForPath(path) !== 'tex') throw new WorkspaceError('The main file must be a .tex file', 415);

  const file = await prisma.workspaceFile.findUnique({
    where: { documentId_path: { documentId: access.document.id, path } },
  });
  if (!file) throw new WorkspaceError('File not found', 404);

  const updated = await prisma.document.update({
    where: { id: access.document.id },
    data: { mainFilePath: path, content: file.content },
  });
  return { mainFilePath: updated.mainFilePath };
}

export function workspaceLimits() {
  return {
    maxFileBytes: MAX_FILE_BYTES,
    maxTextFileBytes: MAX_TEXT_FILE_BYTES,
    maxFilesPerWorkspace: MAX_FILES_PER_WORKSPACE,
    maxWorkspaceBytes: MAX_WORKSPACE_BYTES,
  };
}

export { WorkspacePathError, AccessError };

/**
 * Returns the text of the selected main file, falling back to the legacy column for a
 * document that has not been migrated yet. AI routes and the compile snapshot both use
 * this so they always describe the same bytes the editor is showing.
 */
export async function resolveMainSource(document: {
  id: string;
  mainFilePath?: string | null;
  content?: string | null;
}): Promise<string> {
  await ensureDocumentMigrated(prisma, document.id);
  // The caller's document row may predate migration or a later main-file move.
  const currentDocument = await prisma.document.findUnique({
    where: { id: document.id },
    select: { mainFilePath: true, content: true },
  });
  const mainPath = currentDocument?.mainFilePath || DEFAULT_MAIN_FILE;
  const file = await prisma.workspaceFile.findUnique({
    where: { documentId_path: { documentId: document.id, path: mainPath } },
    select: { content: true },
  });
  return file?.content ?? currentDocument?.content ?? document.content ?? '';
}
