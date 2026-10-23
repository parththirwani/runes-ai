import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-files-'));
process.env.ASSET_STORAGE_DIR = path.join(tmpStorage, 'assets');

type Row = {
  id: string;
  documentId: string;
  path: string;
  kind: string;
  mimeType: string | null;
  sizeBytes: number;
  checksum: string;
  revision: number;
  content: string | null;
  storageKey: string | null;
};

type Doc = { id: string; slug: string; title: string; userId: string; content: string | null; mainFilePath: string; format: 'LATEX' | 'MARKDOWN' };

function fakePrisma(documents: Doc[], files: Row[]) {
  let nextId = 1;
  const rows = files;
  const match = (where: { documentId_path: { documentId: string; path: string } }) =>
    rows.find((row) => row.documentId === where.documentId_path.documentId && row.path === where.documentId_path.path) || null;

  return {
    document: {
      async findFirst({ where }: { where: { slug?: string; userId?: string; id?: string } }) {
        const document = documents.find((doc) => (where.slug === undefined || doc.slug === where.slug) &&
          (where.userId === undefined || doc.userId === where.userId) &&
          (where.id === undefined || doc.id === where.id));
        return document ? { ...document } : null;
      },
      async findUnique({ where }: { where: { id: string } }) {
        const document = documents.find((doc) => doc.id === where.id);
        return document ? { ...document } : null;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const doc = documents.find((candidate) => candidate.id === where.id);
        if (!doc) throw new Error('missing document');
        Object.assign(doc, data);
        return doc;
      },
      async delete() { return null; },
    },
    workspaceFile: {
      async findUnique({ where }: { where: { documentId_path: { documentId: string; path: string } } }) {
        return match(where);
      },
      async findMany({ where }: { where: { documentId: string } }) {
        return rows.filter((row) => row.documentId === where.documentId);
      },
      async count({ where }: { where: { documentId: string } }) {
        return rows.filter((row) => row.documentId === where.documentId).length;
      },
      async aggregate({ where }: { where: { documentId: string } }) {
        const scoped = rows.filter((row) => row.documentId === where.documentId);
        return { _count: { _all: scoped.length }, _sum: { sizeBytes: scoped.reduce((total, row) => total + row.sizeBytes, 0) } };
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row: Row = {
          id: 'file-' + nextId++,
          documentId: data.documentId as string,
          path: data.path as string,
          kind: data.kind as string,
          mimeType: (data.mimeType as string) ?? null,
          sizeBytes: data.sizeBytes as number,
          checksum: data.checksum as string,
          revision: data.revision as number,
          content: (data.content as string) ?? null,
          storageKey: (data.storageKey as string) ?? null,
        };
        rows.push(row);
        return row;
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = rows.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('missing file');
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === 'object' && 'increment' in (value as Record<string, number>)) {
            (row as unknown as Record<string, number>)[key] += (value as { increment: number }).increment;
          } else {
            (row as unknown as Record<string, unknown>)[key] = value;
          }
        }
        return row;
      },
      async upsert({ where, create, update }: { where: { documentId_path: { documentId: string; path: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        const existing = match(where);
        if (!existing) return this.create({ data: create });
        return this.update({ where: { id: existing.id }, data: update });
      },
      async delete({ where }: { where: { id: string } }) {
        const index = rows.findIndex((row) => row.id === where.id);
        if (index >= 0) rows.splice(index, 1);
        return null;
      },
    },
  };
}

let client: ReturnType<typeof fakePrisma>;
vi.mock('@/src/lib/db', () => ({ get prisma() { return client; } }));

import {
  WorkspaceError,
  WorkspacePathError,
  deleteFile,
  ensureDocumentMigrated,
  moveFile,
  readWorkspaceFile,
  readWorkspaceTree,
  resolveMainSource,
  setMainFile,
  uploadFile,
  writeTextFile,
} from '@/src/lib/workspace-files';

function sha(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const OWNER = 'user-owner';
const OTHER = 'user-other';
const DOC_ID = 'doc-1';

function seed(overrides: Partial<Doc> = {}) {
  const documents: Doc[] = [{ id: DOC_ID, slug: 'paper', title: 'Paper', userId: OWNER, content: 'legacy body', mainFilePath: 'main.tex', format: 'LATEX', ...overrides }];
  const files: Row[] = [{
    id: 'file-main', documentId: DOC_ID, path: 'main.tex', kind: 'tex', mimeType: 'text/x-tex',
    sizeBytes: 11, checksum: sha('legacy body'), revision: 3, content: 'legacy body', storageKey: null,
  }];
  client = fakePrisma(documents, files);
  return { documents, files };
}

describe('workspace file service', () => {
  beforeEach(() => { seed(); });

  it('reports the migrated Markdown main file on the first workspace load', async () => {
    const { documents, files } = seed({ format: 'MARKDOWN', content: '# Legacy notes' });
    files.length = 0;

    const workspace = await readWorkspaceTree(OWNER, 'paper');

    expect(documents[0].mainFilePath).toBe('main.md');
    expect(workspace?.document.mainFilePath).toBe('main.md');
    expect(workspace?.files.map((file) => file.path)).toEqual(['main.md']);
    expect(await readWorkspaceFile(OWNER, 'paper', 'main.md')).toMatchObject({ content: '# Legacy notes' });
  });

  it('resolves the Markdown main file when the caller has an older document row', async () => {
    const { documents, files } = seed({ format: 'MARKDOWN', content: '# Current notes' });
    files.length = 0;
    const staleDocument = { id: DOC_ID, mainFilePath: 'main.tex', content: '# Outdated notes' };
    await ensureDocumentMigrated(client as never, DOC_ID);
    files[0].content = '# Edited workspace notes';

    expect(await resolveMainSource(staleDocument)).toBe('# Edited workspace notes');
    expect(documents[0].mainFilePath).toBe('main.md');
    expect(files.map((file) => file.path)).toEqual(['main.md']);
  });

  it('returns nothing for a workspace the user does not own', async () => {
    seed();
    expect(await readWorkspaceTree(OTHER, 'paper')).toBeNull();
    expect(await readWorkspaceFile(OTHER, 'paper', 'main.tex')).toBeNull();
    expect(await writeTextFile({ userId: OTHER, slug: 'paper', rawPath: 'main.tex', content: 'x' })).toBeNull();
    expect(await moveFile({ userId: OTHER, slug: 'paper', from: 'main.tex', to: 'a.tex' })).toBeNull();
    expect(await deleteFile(OTHER, 'paper', 'main.tex')).toBeNull();
    expect(await setMainFile(OTHER, 'paper', 'main.tex')).toBeNull();
    expect(await uploadFile({ userId: OTHER, slug: 'paper', rawPath: 'x.png', bytes: Buffer.from('x') })).toBeNull();
  });

  it('rejects paths that try to leave the workspace', async () => {
    seed();
    for (const bad of ['../../etc/passwd', '/etc/passwd.tex', 'a/../../b.tex', '..\\..\\windows.tex', './x.tex', 'x/../y.tex', '', '   ', 'a//b.tex']) {
      expect(() => readWorkspaceFileNeedsPath(bad)).not.toThrow();
      await expect(writeTextFile({ userId: OWNER, slug: 'paper', rawPath: bad, content: 'x' })).rejects.toBeInstanceOf(WorkspacePathError);
    }
  });

  it('rejects unsupported file types with 415', async () => {
    seed();
    const error = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'payload.exe', content: 'x' }).catch((e) => e);
    expect(error).toBeInstanceOf(WorkspacePathError);
    expect((error as WorkspacePathError).status).toBe(415);
  });

  it('enforces the per file byte limit', async () => {
    seed();
    const tooBig = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'big.tex', content: 'x'.repeat(1024 * 1024 + 1) }).catch((e) => e);
    expect((tooBig as WorkspaceError).status).toBe(413);

    const oversizedImage = await uploadFile({ userId: OWNER, slug: 'paper', rawPath: 'huge.png', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }).catch((e) => e);
    expect((oversizedImage as WorkspaceError).status).toBe(413);
  });

  it('enforces the per workspace byte limit', async () => {
    const { files } = seed();
    for (let index = 0; index < 10; index++) {
      files.push({
        id: 'img-' + index, documentId: DOC_ID, path: 'figures/f' + index + '.png', kind: 'image',
        mimeType: 'image/png', sizeBytes: 49 * 1024 * 1024 / 10, checksum: 'a'.repeat(64), revision: 1,
        content: null, storageKey: 'documents/doc-1/f' + index + '.png',
      });
    }
    const oneMore = await uploadFile({ userId: OWNER, slug: 'paper', rawPath: 'figures/f10.png', bytes: Buffer.alloc(1024 * 1024) }).catch((e) => e);
    expect((oneMore as WorkspaceError).status).toBe(413);
  });

  it('enforces the per workspace file count limit', async () => {
    const { files } = seed();
    for (let index = 0; index < 499; index++) {
      files.push({
        id: 'row-' + index, documentId: DOC_ID, path: 'generated/file' + index + '.tex', kind: 'tex',
        mimeType: 'text/x-tex', sizeBytes: 1, checksum: 'b'.repeat(64), revision: 1, content: 'x', storageKey: null,
      });
    }
    const oneTooMany = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'generated/extra.tex', content: 'x' }).catch((e) => e);
    expect((oneTooMany as WorkspaceError).status).toBe(413);
  });

  it('refuses a second name that differs only by case', async () => {
    seed();
    const error = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'MAIN.TEX', content: 'clash' }).catch((e) => e);
    expect((error as WorkspaceError).status).toBe(409);
  });

  it('rejects a write based on a stale revision', async () => {
    seed();
    const result = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'main.tex', content: 'changed bytes', baseRevision: 2 });
    expect(result && 'conflict' in result).toBe(true);
  });

  it('does not bump the revision when the saved bytes are identical', async () => {
    const { files } = seed();
    const before = files.find((row) => row.path === 'main.tex')!;
    const result = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'main.tex', content: before.content! });
    expect(result && 'unchanged' in result && result.unchanged).toBe(true);
    expect(before.revision).toBe(3);
  });

  it('bumps the revision when the bytes change', async () => {
    const { files } = seed();
    await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'main.tex', content: 'different bytes' });
    expect(files.find((row) => row.path === 'main.tex')!.revision).toBe(4);
  });

  it('keeps the legacy content column pointed at the main file', async () => {
    const { documents } = seed();
    await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'main.tex', content: 'new main source' });
    expect(documents[0].content).toBe('new main source');
    await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'chapters/other.tex', content: 'not main' });
    expect(documents[0].content).toBe('new main source');
  });

  it('updates legacy content on the first Markdown main-file save', async () => {
    const { documents, files } = seed({ format: 'MARKDOWN', content: '# Original' });
    files.length = 0;

    const result = await writeTextFile({ userId: OWNER, slug: 'paper', rawPath: 'main.md', content: '# Edited' });

    expect(result && 'file' in result && result.file.path).toBe('main.md');
    expect(files.find((row) => row.path === 'main.md')?.content).toBe('# Edited');
    expect(documents[0].mainFilePath).toBe('main.md');
    expect(documents[0].content).toBe('# Edited');
  });

  it('follows the main file pointer when it is renamed or moved', async () => {
    const { documents, files } = seed();
    const moved = await moveFile({ userId: OWNER, slug: 'paper', from: 'main.tex', to: 'paper/main.tex' });
    expect(moved && moved !== 'notfound' && moved !== 'exists' && moved.mainFilePath).toBe('paper/main.tex');
    expect(documents[0].mainFilePath).toBe('paper/main.tex');
    expect(files.some((row) => row.path === 'paper/main.tex')).toBe(true);
  });

  it('follows the migrated Markdown main file on its first move', async () => {
    const { documents, files } = seed({ format: 'MARKDOWN', content: '# Original' });
    files.length = 0;

    const moved = await moveFile({ userId: OWNER, slug: 'paper', from: 'main.md', to: 'notes.md' });

    expect(moved && moved !== 'notfound' && moved !== 'exists' && moved.mainFilePath).toBe('notes.md');
    expect(documents[0].mainFilePath).toBe('notes.md');
    expect(files.map((row) => row.path)).toEqual(['notes.md']);
    expect(documents[0].content).toBe('# Original');
  });

  it('refuses to delete the current main file', async () => {
    seed();
    expect(await deleteFile(OWNER, 'paper', 'main.tex')).toBe('mainfile');
    expect(await deleteFile(OWNER, 'paper', 'chapters/gone.tex')).toBe('notfound');
  });

  it('protects the Markdown main file on its first delete request', async () => {
    const { documents, files } = seed({ format: 'MARKDOWN', content: '# Original' });
    files.length = 0;

    expect(await deleteFile(OWNER, 'paper', 'main.md')).toBe('mainfile');
    expect(documents[0].mainFilePath).toBe('main.md');
    expect(files.map((file) => file.path)).toEqual(['main.md']);
    expect(files[0].content).toBe('# Original');
  });

  it('only lets a tex file become the main file', async () => {
    const { files } = seed();
    files.push({ id: 'fig', documentId: DOC_ID, path: 'figures/plot.png', kind: 'image', mimeType: 'image/png', sizeBytes: 4, checksum: 'c'.repeat(64), revision: 1, content: null, storageKey: 'documents/doc-1/plot.png' });
    const notTex = await setMainFile(OWNER, 'paper', 'figures/plot.png').catch((e) => e);
    expect((notTex as WorkspaceError).status).toBe(415);
    files.push({ id: 'alt', documentId: DOC_ID, path: 'alternate.tex', kind: 'tex', mimeType: 'text/x-tex', sizeBytes: 3, checksum: 'd'.repeat(64), revision: 1, content: 'alt', storageKey: null });
    expect((await setMainFile(OWNER, 'paper', 'alternate.tex'))!.mainFilePath).toBe('alternate.tex');
    const missing = await setMainFile(OWNER, 'paper', 'nope.tex').catch((e) => e);
    expect((missing as WorkspaceError).status).toBe(404);
  });

  it('creates main.tex once when a legacy document is first read', async () => {
    const { documents, files } = seed();
    files.length = 0;
    await ensureDocumentMigrated(client as never, DOC_ID);
    expect(files.map((row) => row.path)).toEqual(['main.tex']);
    expect(files[0].content).toBe('legacy body');
    expect(documents[0].mainFilePath).toBe('main.tex');
    await ensureDocumentMigrated(client as never, DOC_ID);
    expect(files).toHaveLength(1);
  });

  it('stores binary uploads by content and refuses empty ones', async () => {
    seed();
    const empty = await uploadFile({ userId: OWNER, slug: 'paper', rawPath: 'figures/x.png', bytes: Buffer.alloc(0) }).catch((e) => e);
    expect((empty as WorkspaceError).status).toBe(400);
    const uploaded = await uploadFile({ userId: OWNER, slug: 'paper', rawPath: 'figures/plot.png', bytes: Buffer.from([1, 2, 3, 4]) });
    expect(uploaded!.kind).toBe('image');
    expect(uploaded!.checksum.length).toBe(64);
    const again = await uploadFile({ userId: OWNER, slug: 'paper', rawPath: 'figures/plot.png', bytes: Buffer.from([1, 2, 3, 4]) });
    expect(again!.revision).toBe(uploaded!.revision);
  });

  it('builds a real tree for nested workspace paths', async () => {
    const { files } = seed();
    files.push(
      { id: 'c1', documentId: DOC_ID, path: 'chapters/methods.tex', kind: 'tex', mimeType: 'text/x-tex', sizeBytes: 2, checksum: 'e'.repeat(64), revision: 1, content: 'a', storageKey: null },
      { id: 'c2', documentId: DOC_ID, path: 'chapters/deep/extra.tex', kind: 'tex', mimeType: 'text/x-tex', sizeBytes: 2, checksum: 'f'.repeat(64), revision: 1, content: 'a', storageKey: null },
      { id: 'f1', documentId: DOC_ID, path: 'figures/plot.png', kind: 'image', mimeType: 'image/png', sizeBytes: 2, checksum: '0'.repeat(64), revision: 1, content: null, storageKey: 'documents/doc-1/plot.png' },
    );
    const tree = await readWorkspaceTree(OWNER, 'paper');
    const folders = tree!.tree.filter((node) => node.type === 'directory').map((node) => node.name);
    expect(folders).toEqual(['chapters', 'figures']);
    const chapters = tree!.tree.find((node) => node.name === 'chapters')!;
    expect(chapters.children!.map((child) => child.name)).toEqual(['deep', 'methods.tex']);
    expect(tree!.document.mainFilePath).toBe('main.tex');
  });
});

function readWorkspaceFileNeedsPath(value: string) {
  return value;
}
