'use client';

// Workspace state for the editor: the real file tree, which files are open, which ones
// are dirty, and what the last compiled snapshot contained.

import { useCallback, useMemo, useRef, useState } from 'react';
import { workspaceClient } from '@/src/lib/workspace-client';
import type { WorkspaceDocumentPayload, WorkspaceFileKind, WorkspaceFileMeta } from '@/src/lib/workspace-types';
import type { TreeNode } from '@/src/lib/workspace-paths';
import { buildTree } from '@/src/lib/workspace-paths';

export type ManagedFile = {
  path: string;
  kind: WorkspaceFileKind;
  revision: number;
  checksum: string;
  sizeBytes: number;
  mimeType: string | null;
  content: string;
  savedContent: string;
  loaded: boolean;
  binary: boolean;
};

export type CompiledSnapshot = { digest: string; mainFile: string; files: { path: string; checksum: string }[] };

function metaToFile(meta: WorkspaceFileMeta): ManagedFile {
  const binary = meta.kind === 'image';
  return {
    path: meta.path,
    kind: meta.kind,
    revision: meta.revision,
    checksum: meta.checksum,
    sizeBytes: meta.sizeBytes,
    mimeType: meta.mimeType,
    content: '',
    savedContent: '',
    loaded: false,
    binary,
  };
}

export function useWorkspace(initialDocument: WorkspaceDocumentPayload | null) {
  const [filesByPath, setFilesByPath] = useState<Record<string, ManagedFile>>(() => {
    if (!initialDocument) return {};
    const map: Record<string, ManagedFile> = {};
    for (const meta of initialDocument.files) {
      const file = metaToFile(meta);
      if (!file.binary) {
        file.loaded = file.path === initialDocument.mainFilePath;
        file.content = file.loaded ? initialDocument.content : '';
        file.savedContent = file.content;
      }
      map[meta.path] = file;
    }
    return map;
  });

  const [mainFilePath, setMainFilePath] = useState(initialDocument?.mainFilePath || 'main.tex');
  const [openPaths, setOpenPaths] = useState<string[]>(() => (initialDocument ? [initialDocument.mainFilePath] : []));
  const [activePath, setActivePath] = useState<string>(initialDocument?.mainFilePath || '');
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [compiledSnapshot, setCompiledSnapshot] = useState<CompiledSnapshot | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const filesRef = useRef(filesByPath);
  filesRef.current = filesByPath;
  const latestSavedRef = useRef(new Map<string, { content: string; revision: number; checksum: string }>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const slugRef = useRef(initialDocument?.slug || '');

  /** A brand new document only gets its slug after the first save. */
  const setSlug = useCallback((slug: string) => {
    slugRef.current = slug;
  }, []);

  const update = useCallback((path: string, patch: Partial<ManagedFile>) => {
    setFilesByPath((current) => {
      const existing = current[path];
      if (!existing) return current;
      return { ...current, [path]: { ...existing, ...patch } };
    });
  }, []);

  const openFile = useCallback(async (path: string) => {
    setOpenPaths((current) => (current.includes(path) ? current : [...current, path]));
    setActivePath(path);

    const existing = filesRef.current[path];
    if (existing?.loaded || existing?.binary) return;

    setBusyPath(path);
    try {
      const loaded = await workspaceClient.loadFile(slugRef.current, path);
      update(path, { content: loaded.content, savedContent: loaded.content, revision: loaded.revision, checksum: loaded.checksum, loaded: true });
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Could not open that file');
    } finally {
      setBusyPath(null);
    }
  }, [update]);

  const closeFile = useCallback((path: string) => {
    setOpenPaths((current) => {
      const next = current.filter((item) => item !== path);
      setActivePath((active) => (active === path ? next[next.length - 1] || '' : active));
      return next;
    });
  }, []);

  const setContent = useCallback((path: string, content: string) => {
    update(path, { content });
  }, [update]);

  const dirtyPaths = useMemo(
    () => Object.values(filesByPath).filter((file) => !file.binary && file.loaded && file.content !== file.savedContent).map((file) => file.path),
    [filesByPath],
  );

  const saveAll = useCallback((): Promise<{ ok: boolean; error?: string }> => {
    const run = async (): Promise<{ ok: boolean; error?: string }> => {
      const dirty = Object.values(filesRef.current).filter((file) => {
        const saved = latestSavedRef.current.get(file.path);
        return !file.binary && file.loaded && file.content !== (saved?.content ?? file.savedContent);
      });
      if (dirty.length === 0) return { ok: true };

      try {
        const response = await workspaceClient.saveFiles(
          slugRef.current,
          dirty.map((file) => {
            const revision = latestSavedRef.current.get(file.path)?.revision ?? file.revision;
            return { path: file.path, content: file.content, baseRevision: revision > 0 ? revision : null };
          }),
        );
        const savedMap = new Map(response.saved.map((item) => [item.path, item]));
        for (const file of dirty) {
          const saved = savedMap.get(file.path);
          if (saved) latestSavedRef.current.set(file.path, { content: file.content, revision: saved.revision, checksum: saved.checksum });
        }
        setFilesByPath((current) => {
          const next = { ...current };
          for (const file of dirty) {
            const saved = savedMap.get(file.path);
            if (saved && next[file.path]) {
              next[file.path] = { ...next[file.path], savedContent: file.content, revision: saved.revision, checksum: saved.checksum };
            }
          }
          return next;
        });
        setLastError(null);
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Save failed' };
      }
    };

    const result = saveQueueRef.current.then(run, run);
    saveQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const createFile = useCallback(async (path: string, content = '') => {
    const result = await workspaceClient.writeFile(slugRef.current, { path, content, revision: 0, checksum: '' });
    const meta = result.file;
    setFilesByPath((current) => ({
      ...current,
      [meta.path]: {
        path: meta.path,
        kind: meta.kind,
        revision: meta.revision,
        checksum: meta.checksum,
        sizeBytes: meta.sizeBytes,
        mimeType: meta.mimeType,
        content,
        savedContent: content,
        loaded: true,
        binary: false,
      },
    }));
    setOpenPaths((current) => (current.includes(meta.path) ? current : [...current, meta.path]));
    setActivePath(meta.path);
    return meta;
  }, []);

  const uploadFile = useCallback(async (path: string, blob: Blob) => {
    const { file } = await workspaceClient.upload(slugRef.current, path, blob);
    setFilesByPath((current) => ({
      ...current,
      [file.path]: {
        path: file.path,
        kind: file.kind,
        revision: file.revision,
        checksum: file.checksum,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        content: '',
        savedContent: '',
        loaded: false,
        binary: file.kind === 'image',
      },
    }));
    return file;
  }, []);

  const removeFile = useCallback(async (path: string) => {
    await workspaceClient.deleteFile(slugRef.current, path);
    latestSavedRef.current.delete(path);
    setFilesByPath((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    closeFile(path);
  }, [closeFile]);

  const renameFile = useCallback(async (from: string, to: string) => {
    const result = await workspaceClient.moveFile(slugRef.current, from, to);
    const saved = latestSavedRef.current.get(from);
    if (saved) {
      latestSavedRef.current.delete(from);
      latestSavedRef.current.set(to, { ...saved, revision: result.file.revision });
    }
    setFilesByPath((current) => {
      const next = { ...current };
      const moved = next[from];
      if (moved) {
        next[to] = { ...moved, path: to };
        delete next[from];
      }
      return next;
    });
    setOpenPaths((current) => current.map((path) => (path === from ? to : path)));
    setActivePath((active) => (active === from ? to : active));
    setMainFilePath(result.mainFilePath);
    return result;
  }, []);

  const chooseMainFile = useCallback(async (path: string) => {
    const result = await workspaceClient.setMainFile(slugRef.current, path);
    setMainFilePath(result.mainFilePath);
    return result;
  }, []);

  /** A saved file whose bytes differ from the compiled snapshot makes the PDF stale. */
  const stalePaths = useMemo(() => {
    if (!compiledSnapshot) return [];
    const compiled = new Map(compiledSnapshot.files.map((file) => [file.path, file.checksum]));
    const stale = new Set<string>();
    for (const file of Object.values(filesByPath)) {
      const before = compiled.get(file.path);
      if (before === undefined) {
        if (file.checksum && file.savedContent !== '') stale.add(file.path);
        continue;
      }
      if (before !== file.checksum) stale.add(file.path);
    }
    for (const path of dirtyPaths) stale.add(path);
    return [...stale];
  }, [compiledSnapshot, filesByPath, dirtyPaths]);

  const tree: TreeNode[] = useMemo(() => buildTree(Object.keys(filesByPath)), [filesByPath]);

  const activeFile = activePath ? filesByPath[activePath] ?? null : null;

  return {
    filesByPath,
    tree,
    mainFilePath,
    openPaths,
    activePath,
    activeFile,
    dirtyPaths,
    stalePaths,
    busyPath,
    lastError,
    setLastError,
    compiledSnapshot,
    setCompiledSnapshot,
    setSlug,
    slug: slugRef.current,
    openFile,
    closeFile,
    setActivePath,
    setContent,
    saveAll,
    createFile,
    uploadFile,
    removeFile,
    renameFile,
    chooseMainFile,
  };
}
