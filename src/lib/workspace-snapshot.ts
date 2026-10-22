// Builds and loads immutable compile snapshots.
//
// The API writes a bundle when a compile is requested; the worker only ever reads that
// bundle. Editing a file after enqueue cannot change a running job, because the job
// refers to a digest, and the bundle for a digest is written once and never updated.

import crypto from 'crypto';
import { prisma } from './db';
import { getJson, putJson, snapshotKey } from './storage';
import {
  buildReferenceClosure,
  findAmbiguousPaths,
  snapshotDigest,
  type CompilerSettings,
  type SnapshotBundle,
  type SnapshotManifest,
} from './latex-snapshot';
import { WorkspaceError } from './workspace-files';

export type SnapshotBuild =
  | { ok: true; digest: string; manifest: SnapshotManifest; bundle: SnapshotBundle }
  | { ok: false; missing: { from: string; raw: string; command: string }[]; ambiguous: string[][] };

function hash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/**
 * Captures the exact bytes a compile needs: the transitive closure of the main file.
 * Files that the main file cannot reach are excluded, so editing one of them does not
 * change the digest and does not invalidate a cached PDF.
 */
export async function createCompileSnapshot(input: {
  documentId: string;
  userId: string;
  mainFile: string;
  compiler: CompilerSettings;
}): Promise<SnapshotBuild> {
  const rows = await prisma.workspaceFile.findMany({
    where: { documentId: input.documentId },
    orderBy: { path: 'asc' },
  });

  if (rows.length === 0) {
    throw new WorkspaceError('This workspace has no files yet', 400);
  }

  const byPath = new Map(rows.map((row) => [row.path, row]));
  const availablePaths = rows.map((row) => row.path);
  const main = byPath.get(input.mainFile) || byPath.get(normalizeKey(input.mainFile));

  if (!main) {
    throw new WorkspaceError('The selected main file ' + input.mainFile + ' does not exist in this workspace', 404);
  }
  if (main.kind !== 'tex') {
    throw new WorkspaceError('The main file must be a .tex file', 400);
  }

  const sources = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.content === 'string' && row.kind !== 'image') sources.set(row.path, row.content);
  }

  const closure = buildReferenceClosure(main.path, sources, availablePaths);
  if (closure.unresolved.length > 0) {
    throw new WorkspaceError(
      'References outside the workspace are not allowed: ' + closure.unresolved.map((r) => r.raw).join(', '),
      400,
    );
  }
  if (closure.missing.length > 0) {
    return { ok: false, missing: closure.missing.map((r) => ({ from: r.from, raw: r.raw, command: r.command })), ambiguous: [] };
  }

  const ambiguous = findAmbiguousPaths(closure.paths);
  if (ambiguous.length > 0) {
    return { ok: false, missing: [], ambiguous: ambiguous.map((paths) => paths) };
  }

  const files = closure.paths
    .map((path) => byPath.get(path))
    .filter((row): row is (typeof rows)[number] => Boolean(row))
    .map((row) => ({ path: row.path, checksum: row.checksum, revision: row.revision, storageKey: row.storageKey }));

  const manifest: SnapshotManifest = {
    version: 1,
    documentId: input.documentId,
    userId: input.userId,
    mainFile: main.path,
    compiler: input.compiler,
    files,
  };

  const digest = snapshotDigest(manifest, hash);
  const bundle: SnapshotBundle = {
    ...manifest,
    inline: closure.paths
      .filter((path) => sources.has(path))
      .map((path) => ({ path, content: sources.get(path)! })),
  };
  await putJson(snapshotKey(digest), bundle);

  return { ok: true, digest, manifest, bundle };
}

function normalizeKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

export async function loadSnapshotBundle(digest: string): Promise<SnapshotBundle | null> {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new WorkspaceError('Invalid snapshot digest', 400);
  return getJson<SnapshotBundle>(snapshotKey(digest));
}

/** True when a stored bundle still describes the workspace's current saved files. */
export async function snapshotIsCurrent(documentId: string, manifest: SnapshotManifest): Promise<boolean> {
  const rows = await prisma.workspaceFile.findMany({
    where: { documentId },
    select: { path: true, checksum: true },
  });
  const current = new Map(rows.map((row) => [row.path, row.checksum]));
  for (const file of manifest.files) {
    if (current.get(file.path) !== file.checksum) return false;
  }
  return true;
}
