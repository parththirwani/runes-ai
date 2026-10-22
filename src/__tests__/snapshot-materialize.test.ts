import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createJobDirectory, materializeLegacySource, materializeSnapshot, pruneJobDirectories, removeJobDirectory } from '@/worker/snapshot-materialize';
import { checksum } from '@/src/lib/storage';
import type { SnapshotBundle } from '@/src/lib/latex-snapshot';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'runes-test-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const MAIN = '\\input{chapters/methods}\n';
const METHODS = 'methods body\n';

function bundle(overrides: Partial<SnapshotBundle> = {}): SnapshotBundle {
  return {
    version: 1,
    documentId: 'doc',
    userId: 'user',
    mainFile: 'main.tex',
    compiler: { engine: 'direct', engineVersion: 'x', mainFile: 'main.tex', options: [] },
    files: [
      { path: 'main.tex', checksum: checksum(MAIN), revision: 1 },
      { path: 'chapters/methods.tex', checksum: checksum(METHODS), revision: 3 },
    ],
    inline: [
      { path: 'main.tex', content: MAIN },
      { path: 'chapters/methods.tex', content: METHODS },
    ],
    ...overrides,
  };
}

describe('job directories', () => {
  it('creates a private directory with an output folder', async () => {
    const jobDir = await createJobDirectory(root, 'job-42');
    expect(jobDir).toBe(path.join(root, 'job-42'));
    await fs.access(path.join(jobDir, 'output'));
  });

  it('refuses job ids that could escape the root', async () => {
    await expect(createJobDirectory(root, '../escape')).rejects.toThrow(/Invalid job id/);
    await expect(createJobDirectory(root, 'a/b')).rejects.toThrow(/Invalid job id/);
  });
});

describe('snapshot materialization', () => {
  it('writes the nested layout that relative \\input paths expect', async () => {
    const jobDir = await createJobDirectory(root, 'job-1');
    const result = await materializeSnapshot(bundle(), jobDir);

    expect(result.files).toBe(2);
    expect(await fs.readFile(path.join(jobDir, 'main.tex'), 'utf-8')).toBe(MAIN);
    expect(await fs.readFile(path.join(jobDir, 'chapters/methods.tex'), 'utf-8')).toBe(METHODS);
    await removeJobDirectory(jobDir);
    await expect(fs.stat(jobDir)).rejects.toThrow();
  });

  it('rejects a path that tries to leave the job directory', async () => {
    const jobDir = await createJobDirectory(root, 'job-2');
    const escaped = bundle({
      files: [{ path: '../outside.tex', checksum: checksum('x'), revision: 1 }],
      inline: [{ path: '../outside.tex', content: 'x' }],
    });
    await expect(materializeSnapshot(escaped, jobDir)).rejects.toThrow();
    await expect(fs.stat(path.join(root, 'outside.tex'))).rejects.toThrow();
  });

  it('rejects an absolute path', async () => {
    const jobDir = await createJobDirectory(root, 'job-3');
    const absolute = bundle({
      files: [{ path: '/etc/abs.tex', checksum: checksum('x'), revision: 1 }],
      inline: [{ path: '/etc/abs.tex', content: 'x' }],
    });
    await expect(materializeSnapshot(absolute, jobDir)).rejects.toThrow();
  });

  it('does not trust the stored checksum', async () => {
    const jobDir = await createJobDirectory(root, 'job-4');
    const tampered = bundle({
      files: [{ path: 'main.tex', checksum: checksum('different bytes'), revision: 1 }],
      inline: [{ path: 'main.tex', content: MAIN }],
    });
    await expect(materializeSnapshot(tampered, jobDir)).rejects.toThrow(/Checksum mismatch/);
  });

  it('replaces anything already sitting at a target path instead of writing through it', async () => {
    const jobDir = await createJobDirectory(root, 'job-5');
    await fs.writeFile(path.join(jobDir, 'main.tex'), 'stale', 'utf-8');
    await materializeSnapshot(bundle(), jobDir);
    expect(await fs.readFile(path.join(jobDir, 'main.tex'), 'utf-8')).toBe(MAIN);
  });

  it('materializes a legacy single source document as main.tex', async () => {
    const jobDir = await createJobDirectory(root, 'job-6');
    const result = await materializeLegacySource('\\documentclass{article}', 'main.tex', jobDir);
    expect(result).toEqual({ files: 1, bytes: '\\documentclass{article}'.length });
  });

  it('prunes only directories older than the cutoff', async () => {
    const old = await createJobDirectory(root, 'old-job');
    const fresh = await createJobDirectory(root, 'new-job');
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(old, past, past);

    expect(await pruneJobDirectories(root, 30_000)).toBe(1);
    await expect(fs.stat(old)).rejects.toThrow();
    await fs.access(fresh);
  });

  it('is a no-op when the compile root does not exist yet', async () => {
    expect(await pruneJobDirectories(path.join(root, 'missing'), 1000)).toBe(0);
  });
});
