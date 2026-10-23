// Workspace file service: ownership, limits, revisions and legacy-document migration.
//
// Every entry point takes the authenticated user id and re-checks ownership, so a route
// cannot accidentally read another user's workspace by guessing an id or a path.

import { prisma } from './db';
import { checksum, assetKey, putBytes, getBytes } from './storage';
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
  document: { id: string; slug: string; title: string; format: 'LATEX' | 'MARKDOWN'; mainFilePath: string; updatedAt: Date };
  files: WorkspaceFileRecord[];
  tree: TreeNode[];
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
 * Creates the format's main file for documents that still only have the legacy content column.
 * Safe to call on every read: it only acts when no file exists yet.
 */
export async function ensureDocumentMigrated(client: typeof prisma, documentId: string): Promise<void> {
  const fileCount = await client.workspaceFile.count({ where: { documentId } });
  if (fileCount > 0) return;

  const document = await client.document.findUnique({ where: { id: documentId }, select: { content: true, format: true } });
  const content = document?.content ?? '';
  const bytes = Buffer.from(content, 'utf-8');
  const mainFile = document?.format === 'MARKDOWN' ? 'main.md' : DEFAULT_MAIN_FILE;

  await client.workspaceFile.create({
    data: {
      documentId,
      path: mainFile,
      kind: document?.format === 'MARKDOWN' ? 'other' : 'tex',
      mimeType: document?.format === 'MARKDOWN' ? 'text/markdown' : 'text/x-tex',
      sizeBytes: bytes.byteLength,
      checksum: checksum(bytes),
      revision: 1,
      content,
    },
  });
  await client.document.update({ where: { id: documentId }, data: { mainFilePath: mainFile } });
}

export async function getOwnedDocument(userId: string, slug: string) {
  const document = await prisma.document.findFirst({ where: { slug, userId } });
  if (!document) return null;
  return document;
}

export async function readWorkspaceTree(userId: string, slug: string): Promise<WorkspaceTree | null> {
  const document = await getOwnedDocument(userId, slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);
  // Migration can replace the legacy main.tex pointer with main.md. Prisma returns
  // distinct row objects, so the document fetched before migration is stale.
  const currentDocument = await prisma.document.findUnique({ where: { id: document.id } });
  if (!currentDocument) return null;

  const files = await prisma.workspaceFile.findMany({
    where: { documentId: document.id },
    orderBy: { path: 'asc' },
  });

  return {
    document: {
      id: currentDocument.id,
      slug: currentDocument.slug,
      title: currentDocument.title,
      format: currentDocument.format,
      mainFilePath: currentDocument.mainFilePath,
      updatedAt: currentDocument.updatedAt,
    },
    files: files.map(publicFile),
    tree: buildTree(files.map((file) => file.path)),
  };
}

export async function readWorkspaceFile(userId: string, slug: string, rawPath: string): Promise<WorkspaceFileContent | null> {
  const document = await getOwnedDocument(userId, slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);

  const path = assertSafeWorkspacePath(rawPath);
  const file = await prisma.workspaceFile.findUnique({
    where: { documentId_path: { documentId: document.id, path } },
  });
  if (!file) return null;

  return { ...publicFile(file), content: file.content, binary: !TEXT_KINDS.has(file.kind) };
}

export async function readWorkspaceAsset(userId: string, slug: string, rawPath: string) {
  const document = await getOwnedDocument(userId, slug);
  if (!document) return null;
  const path = assertSafeWorkspacePath(rawPath);
  const file = await prisma.workspaceFile.findUnique({
    where: { documentId_path: { documentId: document.id, path } },
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
  const document = await getOwnedDocument(input.userId, input.slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);
  const currentDocument = await prisma.document.findUnique({ where: { id: document.id } });
  if (!currentDocument) return null;

  const path = assertSafeWorkspacePath(input.rawPath);
  const kind = kindForPath(path);
  if (!TEXT_KINDS.has(kind)) throw new WorkspaceError('Use the upload endpoint for ' + path, 415);

  const bytes = Buffer.from(input.content, 'utf-8');
  const hash = checksum(bytes);
  const existing = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path } } });

  // A save that writes the same bytes is a no-op. Bumping the revision here would change
  // the snapshot digest and force a full recompile of unchanged source after every autosave.
  if (existing && existing.checksum === hash && existing.kind === kind) {
    return { file: publicFile(existing), created: false, unchanged: true };
  }

  await assertCanStore(prisma, document.id, path, bytes.byteLength, existing);
  if (input.baseRevision !== undefined && input.baseRevision !== null) {
    if (existing && existing.revision !== input.baseRevision) {
      return { conflict: publicFile(existing) };
    }
  }

  if (!existing) await assertNoCollision(prisma, document.id, path);

  const isMain = pathsCollide(path, currentDocument.mainFilePath);
  const file = await prisma.workspaceFile.upsert({
    where: { documentId_path: { documentId: document.id, path } },
    create: {
      documentId: document.id,
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
  if (isMain) await prisma.document.update({ where: { id: document.id }, data: { content: input.content } });

  return { file: publicFile(file), created: !existing, unchanged: false };
}

export async function uploadFile(input: {
  userId: string;
  slug: string;
  rawPath: string;
  bytes: Buffer;
  mimeType?: string | null;
}): Promise<WorkspaceFileRecord | null> {
  const document = await getOwnedDocument(input.userId, input.slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);

  const path = assertSafeWorkspacePath(input.rawPath);
  const kind = kindForPath(path);
  if (input.bytes.byteLength === 0) throw new WorkspaceError('Uploaded file is empty', 400);

  const hash = checksum(input.bytes);
  const existing = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path } } });
  if (existing && existing.checksum === hash) return publicFile(existing);

  await assertCanStore(prisma, document.id, path, input.bytes.byteLength, existing);
  if (!existing) await assertNoCollision(prisma, document.id, path);

  const extension = path.slice(path.lastIndexOf('.'));
  const storageKey = assetKey(document.id, hash, extension);
  await putBytes(storageKey, input.bytes);

  const isText = TEXT_KINDS.has(kind);
  const file = await prisma.workspaceFile.upsert({
    where: { documentId_path: { documentId: document.id, path } },
    create: {
      documentId: document.id,
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

  if (pathsCollide(path, document.mainFilePath) && isText) {
    await prisma.document.update({ where: { id: document.id }, data: { content: input.bytes.toString('utf-8') } });
  }
  return publicFile(file);
}

export async function deleteFile(userId: string, slug: string, rawPath: string): Promise<'deleted' | 'notfound' | 'mainfile' | null> {
  const document = await getOwnedDocument(userId, slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);
  const currentDocument = await prisma.document.findUnique({ where: { id: document.id } });
  if (!currentDocument) return null;
  const path = assertSafeWorkspacePath(rawPath);
  if (pathsCollide(path, currentDocument.mainFilePath)) return 'mainfile';

  const existing = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path } } });
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
  const document = await getOwnedDocument(input.userId, input.slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);
  const currentDocument = await prisma.document.findUnique({ where: { id: document.id } });
  if (!currentDocument) return null;

  const from = assertSafeWorkspacePath(input.from, 'from');
  const to = assertSafeWorkspacePath(input.to, 'to');
  if (from === to) {
    const same = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path: from } } });
    return same ? { file: publicFile(same), mainFilePath: currentDocument.mainFilePath } : 'notfound';
  }

  const source = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path: from } } });
  if (!source) return 'notfound';
  const target = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path: to } } });
  if (target) return 'exists';
  await assertNoCollision(prisma, document.id, to, source.id);

  // The extension decides the kind; binary payloads keep their stored bytes and key.
  const kind = kindForPath(to);
  const file = await prisma.workspaceFile.update({
    where: { id: source.id },
    data: { path: to, kind, revision: { increment: 1 } },
  });

  let mainFilePath = currentDocument.mainFilePath;
  if (pathsCollide(from, currentDocument.mainFilePath)) {
    mainFilePath = to;
    await prisma.document.update({ where: { id: document.id }, data: { mainFilePath: to, content: file.content } });
  }
  return { file: publicFile(file), mainFilePath };
}

export async function setMainFile(userId: string, slug: string, rawPath: string) {
  const document = await getOwnedDocument(userId, slug);
  if (!document) return null;
  await ensureDocumentMigrated(prisma, document.id);

  const path = assertSafeWorkspacePath(rawPath);
  if (kindForPath(path) !== 'tex') throw new WorkspaceError('The main file must be a .tex file', 415);

  const file = await prisma.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path } } });
  if (!file) throw new WorkspaceError('File not found', 404);

  const updated = await prisma.document.update({
    where: { id: document.id },
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

export { WorkspacePathError };

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
