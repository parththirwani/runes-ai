// Repeatable backfill from the legacy Document.content column to workspace files.
//
// Kept free of CLI concerns so the same code path is exercised by tests.

import crypto from 'crypto';

export const MIGRATION_MAIN_FILE = 'main.tex';

type DocumentRow = {
  id: string;
  slug: string;
  title: string;
  userId: string;
  content: string | null;
  mainFilePath: string | null;
};

export type MigrationClient = {
  document: {
    findMany: (input: { select: Record<string, boolean>; orderBy?: Record<string, string> }) => Promise<(DocumentRow & { createdAt?: Date })[]>;
    findUnique: (input: { where: { id: string } }) => Promise<{ id: string; email?: string } | null>;
    update: (input: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
  };
  workspaceFile: {
    count: (input: { where: { documentId: string } }) => Promise<number>;
    findUnique: (input: { where: { documentId_path: { documentId: string; path: string } } }) => Promise<{ content: string | null; checksum: string } | null>;
    create: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  };
  chatSession?: { count: (input: { where: { documentId: string } }) => Promise<number> };
  user?: { findUnique: (input: { where: { id: string } }) => Promise<{ id: string } | null> };
  $transaction: (operations: unknown[]) => Promise<unknown>;
};

export type ApplyReport = { documents: number; created: number; alreadyMigrated: number; emptySource: number };
export type VerifyReport = { documents: number; workspaceFiles: number; problems: string[] };

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Creates main.tex for every document that has no workspace files yet. Reruns are no-ops. */
export async function applyWorkspaceBackfill(client: MigrationClient): Promise<ApplyReport> {
  const documents = await client.document.findMany({
    select: { id: true, slug: true, title: true, userId: true, content: true, mainFilePath: true },
    orderBy: { createdAt: 'asc' },
  });

  const report: ApplyReport = { documents: documents.length, created: 0, alreadyMigrated: 0, emptySource: 0 };

  for (const document of documents) {
    if (await client.workspaceFile.count({ where: { documentId: document.id } }) > 0) {
      report.alreadyMigrated++;
      continue;
    }
    const content = document.content ?? '';
    if (content.length === 0) report.emptySource++;

    const bytes = Buffer.from(content, 'utf-8');
    await client.$transaction([
      client.workspaceFile.create({
        data: {
          documentId: document.id,
          path: MIGRATION_MAIN_FILE,
          kind: 'tex',
          mimeType: 'text/x-tex',
          sizeBytes: bytes.byteLength,
          checksum: sha256Hex(content),
          revision: 1,
          content,
        },
      }),
      client.document.update({ where: { id: document.id }, data: { mainFilePath: MIGRATION_MAIN_FILE } }),
    ]);
    report.created++;
  }

  return report;
}

/**
 * Verifies nothing was lost: every document has a main file, its bytes match the legacy
 * column when that column still has them, and stored checksums match stored bytes.
 */
export async function verifyWorkspaceBackfill(client: MigrationClient, countWorkspaceFiles: () => Promise<number>): Promise<VerifyReport> {
  const documents = await client.document.findMany({
    select: { id: true, slug: true, title: true, userId: true, content: true, mainFilePath: true },
    orderBy: { createdAt: 'asc' },
  });

  const problems: string[] = [];

  for (const document of documents) {
    const path = document.mainFilePath && document.mainFilePath.length > 0 ? document.mainFilePath : MIGRATION_MAIN_FILE;
    const main = await client.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path } } });

    if (!main) {
      problems.push(document.slug + ': main file ' + path + ' is missing');
      continue;
    }
    const stored = main.content ?? '';
    if (typeof document.content === 'string' && document.content.length > 0 && sha256Hex(document.content) !== sha256Hex(stored)) {
      problems.push(document.slug + ': main file bytes differ from Document.content');
    }
    if (main.checksum !== sha256Hex(stored)) {
      problems.push(document.slug + ': stored checksum does not match stored bytes');
    }
    if (!document.slug) problems.push(document.id + ': slug is missing');
    if (!document.title) problems.push(document.slug + ': title is missing');
    if (client.user && !(await client.user.findUnique({ where: { id: document.userId } }))) {
      problems.push(document.slug + ': owner is missing');
    }
  }

  return { documents: documents.length, workspaceFiles: await countWorkspaceFiles(), problems };
}

/** Restores Document.content from the current main file so the old code path works again. */
export async function rollbackToLegacyContent(client: MigrationClient): Promise<{ documents: number; restored: number }> {
  const documents = await client.document.findMany({
    select: { id: true, slug: true, title: true, userId: true, content: true, mainFilePath: true },
  });

  let restored = 0;
  for (const document of documents) {
    const path = document.mainFilePath && document.mainFilePath.length > 0 ? document.mainFilePath : MIGRATION_MAIN_FILE;
    const main = await client.workspaceFile.findUnique({ where: { documentId_path: { documentId: document.id, path } } });
    if (main && typeof main.content === 'string') {
      await client.document.update({ where: { id: document.id }, data: { content: main.content } });
      restored++;
    }
  }
  return { documents: documents.length, restored };
}
