import { describe, expect, it } from 'vitest';
import {
  applyWorkspaceBackfill,
  rollbackToLegacyContent,
  sha256Hex,
  verifyWorkspaceBackfill,
  type MigrationClient,
} from '@/src/lib/workspace-migration';

type Row = {
  id: string;
  slug: string;
  title: string;
  userId: string;
  content: string | null;
  mainFilePath: string | null;
  createdAt: Date;
};

/** Minimal in-memory stand-in for the Prisma models the backfill touches. */
function fakeClient(documents: Row[]) {
  const files: { documentId: string; path: string; content: string | null; checksum: string }[] = [];
  const chats = [{ documentId: documents[0]?.id ?? 'none' }];

  const client = {
    document: {
      async findMany() {
        return documents.map((document) => ({ ...document }));
      },
      async findUnique({ where }: { where: { id: string } }) {
        return documents.find((document) => document.id === where.id) ?? null;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const document = documents.find((candidate) => candidate.id === where.id);
        if (!document) throw new Error('missing document ' + where.id);
        Object.assign(document, data);
        return document;
      },
    },
    workspaceFile: {
      async count({ where }: { where: { documentId: string } }) {
        return files.filter((file) => file.documentId === where.documentId).length;
      },
      async findUnique({ where }: { where: { documentId_path: { documentId: string; path: string } } }) {
        return files.find((file) => file.documentId === where.documentId_path.documentId && file.path === where.documentId_path.path) ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = {
          documentId: data.documentId as string,
          path: data.path as string,
          content: (data.content as string) ?? null,
          checksum: data.checksum as string,
        };
        if (files.some((file) => file.documentId === row.documentId && file.path === row.path)) {
          throw new Error('duplicate file ' + row.documentId + '/' + row.path);
        }
        files.push(row);
        return row;
      },
    },
    chatSession: {
      async count({ where }: { where: { documentId: string } }) {
        return chats.filter((chat) => chat.documentId === where.documentId).length;
      },
    },
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return documents.some((document) => document.userId === where.id) ? { id: where.id } : null;
      },
    },
    async $transaction(operations: unknown[]) {
      await Promise.all(operations.map((operation) => Promise.resolve(operation)));
    },
  };

  return { client: client as unknown as MigrationClient, files, chats };
}

const SOURCE = '\\documentclass{article}\n\\begin{document}Hello\\end{document}\n';

function documents(): Row[] {
  return [
    { id: 'doc-1', slug: 'first-paper', title: 'First Paper', userId: 'user-1', content: SOURCE, mainFilePath: null, createdAt: new Date('2026-01-01') },
    { id: 'doc-2', slug: 'second-paper', title: 'Second Paper', userId: 'user-2', content: '\\documentclass{report}', mainFilePath: null, createdAt: new Date('2026-01-02') },
    { id: 'doc-3', slug: 'empty-paper', title: 'Empty Paper', userId: 'user-1', content: null, mainFilePath: null, createdAt: new Date('2026-01-03') },
  ];
}

describe('workspace backfill', () => {
  it('turns every legacy document into a main.tex workspace', async () => {
    const rows = documents();
    const { client, files } = fakeClient(rows);

    const report = await applyWorkspaceBackfill(client);
    expect(report).toEqual({ documents: 3, created: 3, alreadyMigrated: 0, emptySource: 1 });

    const migrated = await client.document.findMany({ select: {}, orderBy: {} });
    expect(migrated.map((document) => document.mainFilePath)).toEqual(['main.tex', 'main.tex', 'main.tex']);

    const first = files.find((file) => file.documentId === 'doc-1');
    expect(first?.content).toBe(SOURCE);
    expect(first?.checksum).toBe(sha256Hex(SOURCE));
    expect(first?.path).toBe('main.tex');
  });

  it('is byte identical, so no document content is lost', async () => {
    const rows = documents();
    const { client, files } = fakeClient(rows);
    await applyWorkspaceBackfill(client);

    for (const row of rows) {
      const file = files.find((candidate) => candidate.documentId === row.id);
      expect(file?.content ?? '').toBe(row.content ?? '');
    }
  });

  it('re-running the backfill does not duplicate files', async () => {
    const { client, files } = fakeClient(documents());
    await applyWorkspaceBackfill(client);
    const second = await applyWorkspaceBackfill(client);
    const third = await applyWorkspaceBackfill(client);

    expect(second).toMatchObject({ created: 0, alreadyMigrated: 3 });
    expect(third).toMatchObject({ created: 0, alreadyMigrated: 3 });
    expect(files).toHaveLength(3);
  });

  it('verification passes after a clean backfill and fails on a lost byte', async () => {
    const rows = documents();
    const { client, files } = fakeClient(rows);
    await applyWorkspaceBackfill(client);

    const verify = () => verifyWorkspaceBackfill(client, async () => files.length);
    const clean = await verify();
    expect(clean.problems).toEqual([]);
    expect(clean).toMatchObject({ documents: 3, workspaceFiles: 3 });

    const target = files.find((file) => file.documentId === 'doc-1')!;
    target.content = (target.content ?? '') + ' ';
    const dirty = await verify();
    expect(dirty.problems.join(' ')).toContain('differ from Document.content');
  });

  it('verification reports a missing main file', async () => {
    const rows = documents();
    const { client } = fakeClient(rows);
    const report = await verifyWorkspaceBackfill(client, async () => 0);
    expect(report.problems).toHaveLength(3);
    expect(report.problems[0]).toContain('main file main.tex is missing');
  });

  it('rollback restores the legacy column from the current main file', async () => {
    const rows = documents();
    const { client, files } = fakeClient(rows);
    await applyWorkspaceBackfill(client);

    const edited = files.find((file) => file.documentId === 'doc-1')!;
    edited.content = '\\documentclass{article}% edited';

    const result = await rollbackToLegacyContent(client);
    expect(result).toEqual({ documents: 3, restored: 3 });

    const rolled = await client.document.findMany({ select: {}, orderBy: {} });
    expect(rolled.find((document) => document.id === 'doc-1')?.content).toBe('\\documentclass{article}% edited');
  });

  it('leaves slugs, titles, owners and chat rows untouched', async () => {
    const rows = documents();
    const before = rows.map(({ slug, title, userId }) => ({ slug, title, userId }));
    const { client, chats } = fakeClient(rows);
    await applyWorkspaceBackfill(client);

    const after = (await client.document.findMany({ select: {}, orderBy: {} })).map(({ slug, title, userId }) => ({ slug, title, userId }));
    expect(after).toEqual(before);
    expect(chats).toHaveLength(1);
  });
});
