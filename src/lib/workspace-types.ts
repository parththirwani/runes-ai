// Shapes shared by the workspace API routes and the browser client.

import type { CompileDiagnostic } from './compile-errors';
import type { TreeNode } from './workspace-paths';

export type WorkspaceFileKind = 'tex' | 'bib' | 'image' | 'other';

export type WorkspaceFileMeta = {
  id: string;
  path: string;
  kind: WorkspaceFileKind;
  mimeType: string | null;
  sizeBytes: number;
  checksum: string;
  revision: number;
  updatedAt: string;
};

/** What the capability service decided for the signed-in user and this document. */
export type DocumentAccessFlags = {
  canEdit: boolean;
  canShare: boolean;
  canMove: boolean;
  canDelete: boolean;
  level: 'Edit' | 'View';
  source: string | null;
};

export type DocumentAuthor = { id: string; name?: string | null; email?: string | null };

export type WorkspaceDocumentPayload = {
  id: string;
  format: 'LATEX' | 'MARKDOWN';
  title: string;
  slug: string;
  content: string;
  mainFilePath: string;
  updatedAt: string;
  mainFile: { path: string; revision: number; checksum: string } | null;
  files: WorkspaceFileMeta[];
  tree: TreeNode[];
  /** The editor renders viewers from these two; the server repeats the check per request. */
  author?: DocumentAuthor | null;
  access?: DocumentAccessFlags;
};

export type CompileResponse = {
  jobId: string;
  reused: 'new' | 'running' | 'completed';
  message: string;
  snapshot?: { digest: string; mainFile: string; files: { path: string; checksum: string; revision: number }[] };
};

export type MissingReference = { file: string; reference: string; command: string };

export type JobTimings = {
  requestedAt?: number;
  enqueuedAt?: number;
  dequeuedAt?: number;
  compileStartedAt?: number;
  compileEndedAt?: number;
  pdfStoredAt?: number;
  completedAt?: number;
  queueWaitMs?: number;
  compileMs?: number;
  storeMs?: number;
  totalMs?: number;
  compiler?: {
    materializeMs?: number;
    processSpawnMs?: number;
    engineMs?: number;
    pdfReadMs?: number;
    totalMs?: number;
  };
};

export type JobStatusPayload = {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: {
    success: boolean;
    error?: string;
    diagnostics?: CompileDiagnostic[];
    logExcerpt?: string;
    duration: number;
    pdfUrl?: string;
  };
  timings?: JobTimings;
  snapshot?: { digest: string; mainFile: string; files: { path: string; checksum: string; revision: number }[] };
  createdAt: number;
  completedAt?: number;
};
