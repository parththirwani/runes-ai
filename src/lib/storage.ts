// Content addressed storage for binary workspace assets and compile snapshots.
//
// Two roots are configured separately on purpose:
//   ASSET_STORAGE_DIR  durable bytes (uploaded images, snapshot manifests)
//   COMPILE_TMP_DIR    throwaway per job directories, never inside the project tree
//
// Local is the only driver implemented. Set STORAGE_DRIVER=s3 and the process refuses
// to start rather than silently writing durable bytes somewhere unexpected.

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export type StorageDriver = 'local';

export function storageDriver(): StorageDriver {
  const configured = (process.env.STORAGE_DRIVER || 'local').trim().toLowerCase();
  if (configured !== 'local') {
    throw new Error('STORAGE_DRIVER=' + configured + ' is not implemented; use local or add an adapter in src/lib/storage.ts');
  }
  return 'local';
}

const projectDefault = () => path.join(process.cwd(), '.data', 'assets');

export function assetStorageDir(): string {
  return path.resolve(process.env.ASSET_STORAGE_DIR || projectDefault());
}

export function compileTmpDir(): string {
  const configured = process.env.COMPILE_TMP_DIR?.trim();
  if (configured) return path.resolve(configured);
  // Outside the source tree by default so compile scratch never lands in project storage.
  return path.join(os.tmpdir(), 'runes-compile');
}

function assertSafeKey(key: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(key)) throw new Error('Invalid storage key');
  if (key.split('/').some((segment) => segment === '.' || segment === '..')) throw new Error('Invalid storage key');
  return key;
}

/** Asset keys are content addressed, so the same bytes are written once and never mutate. */
export function assetKey(documentId: string, checksum: string, extension: string): string {
  const safeExtension = extension.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return path.posix.join('documents', assertSafeKey(documentId), checksum + safeExtension).replace(/^\/+/, '');
}

export function snapshotKey(digest: string): string {
  return path.posix.join('snapshots', assertSafeKey(digest) + '.json');
}

export async function putBytes(key: string, bytes: Buffer): Promise<string> {
  const target = path.join(assetStorageDir(), assertSafeKey(key));
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(target, bytes, { flag: 'wx' });
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code !== 'EEXIST') throw error;
  }
  return key;
}

export async function getBytes(key: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(path.join(assetStorageDir(), assertSafeKey(key)));
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

export async function putJson(key: string, value: unknown): Promise<string> {
  return putBytes(key, Buffer.from(JSON.stringify(value), 'utf-8'));
}

export async function getJson<T>(key: string): Promise<T | null> {
  const bytes = await getBytes(key);
  if (!bytes) return null;
  return JSON.parse(bytes.toString('utf-8')) as T;
}

/** Removes snapshot manifests older than the job lifetime so scratch bytes do not pile up. */
export async function pruneSnapshots(olderThanMs: number): Promise<number> {
  const dir = path.join(assetStorageDir(), 'snapshots');
  let removed = 0;
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'ENOENT') return 0;
    throw error;
  }
  const cutoff = Date.now() - olderThanMs;
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const stat = await fs.stat(full);
      if (stat.mtimeMs < cutoff) {
        await fs.rm(full, { force: true });
        removed++;
      }
    } catch {
      // A concurrent prune or a missing file is not an error worth failing on.
    }
  }
  return removed;
}

export function checksum(bytes: Buffer | string): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
