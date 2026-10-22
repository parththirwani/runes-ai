// Browser side workspace API client.

import type { CompileResponse, JobStatusPayload, WorkspaceDocumentPayload, WorkspaceFileMeta, MissingReference } from './workspace-types';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    const error = new Error((data.message as string) || (data.error as string) || 'Request failed');
    (error as Error & { status: number; payload?: Record<string, unknown> }).status = response.status;
    (error as Error & { status: number; payload?: Record<string, unknown> }).payload = data;
    throw error;
  }
  return data as T;
}

export type LoadedFile = { path: string; content: string; revision: number; checksum: string };

export const workspaceClient = {
  load: (slug: string) =>
    request<{ document: WorkspaceDocumentPayload }>('/api/document/' + encodeURIComponent(slug)).then((data) => data.document),

  loadFile: (slug: string, path: string) =>
    request<{ file: WorkspaceFileMeta & { content: string | null } }>(
      '/api/document/' + encodeURIComponent(slug) + '/file?path=' + encodeURIComponent(path),
    ).then((data) => ({
      path: data.file.path,
      content: data.file.content ?? '',
      revision: data.file.revision,
      checksum: data.file.checksum,
    })),

  saveFiles: (slug: string, files: { path: string; content: string; baseRevision: number | null }[], title?: string) =>
    request<{ saved: { path: string; revision: number; checksum: string }[] }>(
      '/api/document/' + encodeURIComponent(slug),
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(title ? { title, files } : { files }) },
    ),

  writeFile: (slug: string, file: LoadedFile & { baseRevision?: number | null }) =>
    request<{ file: WorkspaceFileMeta }>('/api/document/' + encodeURIComponent(slug) + '/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: file.path, content: file.content, baseRevision: file.baseRevision ?? null }),
    }),

  deleteFile: (slug: string, path: string) =>
    request<{ message: string }>(
      '/api/document/' + encodeURIComponent(slug) + '/file?path=' + encodeURIComponent(path),
      { method: 'DELETE' },
    ),

  moveFile: (slug: string, from: string, to: string) =>
    request<{ file: WorkspaceFileMeta; mainFilePath: string }>('/api/document/' + encodeURIComponent(slug) + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }),

  setMainFile: (slug: string, path: string) =>
    request<{ mainFilePath: string }>('/api/document/' + encodeURIComponent(slug) + '/main', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    }),

  upload: (slug: string, path: string, file: File | Blob) => {
    const form = new FormData();
    form.append('path', path);
    form.append('file', file, path.split('/').pop() || 'file');
    return request<{ file: WorkspaceFileMeta }>('/api/document/' + encodeURIComponent(slug) + '/upload', { method: 'POST', body: form });
  },

  compile: (slug: string) =>
    request<CompileResponse>('/api/document/' + encodeURIComponent(slug), { method: 'POST' }),

  jobStatus: (jobId: string) => request<JobStatusPayload>('/api/job/' + encodeURIComponent(jobId)),

  assetUrl: (slug: string, path: string) =>
    '/api/document/' + encodeURIComponent(slug) + '/asset?path=' + encodeURIComponent(path),
};

export function missingReferencesFrom(error: unknown): MissingReference[] | null {
  const payload = (error as { payload?: Record<string, unknown> })?.payload;
  const missing = payload?.missing;
  return Array.isArray(missing) ? (missing as MissingReference[]) : null;
}
