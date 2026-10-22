// Materializes a snapshot bundle into a private per-job directory.
//
// Every path is revalidated here: the database is not trusted to contain safe paths,
// because rows written by an older version or a buggy migration still get compiled.

import { promises as fs } from 'fs';
import path from 'path';
import { getBytes } from '@/src/lib/storage';
import { checksum } from '@/src/lib/storage';
import { resolveInsideDirectory, normalizeWorkspacePath } from '@/src/lib/workspace-paths';
import type { SnapshotBundle } from '@/src/lib/latex-snapshot';

export type MaterializedSnapshot = { files: number; bytes: number };

export async function createJobDirectory(rootDir: string, jobId: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) throw new Error('Invalid job id');
  const jobDir = path.join(rootDir, jobId);
  await fs.mkdir(jobDir, { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(jobDir, 'output'), { recursive: true, mode: 0o700 });
  return jobDir;
}

export async function removeJobDirectory(jobDir: string): Promise<void> {
  await fs.rm(jobDir, { recursive: true, force: true });
}

/** Writes text files inline and pulls binary assets from content-addressed storage. */
export async function materializeSnapshot(bundle: SnapshotBundle, jobDir: string): Promise<MaterializedSnapshot> {
  const inline = new Map(bundle.inline.map((entry) => [entry.path, entry.content]));
  let files = 0;
  let bytes = 0;

  for (const file of bundle.files) {
    const safePath = normalizeWorkspacePath(file.path);
    if (safePath !== file.path) throw new Error('Snapshot path failed validation: ' + file.path);
    const target = resolveInsideDirectory(jobDir, safePath);

    const text = inline.get(file.path);
    let payload: Buffer;
    if (text !== undefined) {
      payload = Buffer.from(text, 'utf-8');
    } else if (file.storageKey) {
      const stored = await getBytes(file.storageKey);
      if (!stored) throw new Error('Missing stored asset for ' + safePath);
      payload = stored;
    } else {
      throw new Error('Snapshot has no bytes for ' + safePath);
    }

    if (checksum(payload) !== file.checksum) {
      throw new Error('Checksum mismatch for ' + safePath);
    }

    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    // A snapshot must never follow a link, so refuse to write through anything that
    // already exists in the job directory.
    try {
      await fs.lstat(target);
      await fs.rm(target, { force: true });
    } catch {
      // normal case: nothing there yet
    }
    await fs.writeFile(target, payload);
    files++;
    bytes += payload.byteLength;
  }

  if (files === 0) throw new Error('Snapshot contained no files');
  return { files, bytes };
}

/** Legacy single source documents compile as a one file workspace. */
export async function materializeLegacySource(content: string, mainFile: string, jobDir: string): Promise<MaterializedSnapshot> {
  const safePath = normalizeWorkspacePath(mainFile);
  const target = resolveInsideDirectory(jobDir, safePath);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(target, content, 'utf-8');
  return { files: 1, bytes: Buffer.byteLength(content, 'utf-8') };
}

/** Removes job directories left behind by a crash. */
export async function pruneJobDirectories(rootDir: string, olderThanMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(rootDir);
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  const cutoff = Date.now() - olderThanMs;
  for (const entry of entries) {
    const full = path.join(rootDir, entry);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(full, { recursive: true, force: true });
        removed++;
      }
    } catch {
      // ignore races with a concurrent prune
    }
  }
  return removed;
}
