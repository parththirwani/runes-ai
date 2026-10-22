// Shared types for the compile queue. Timings use epoch milliseconds recorded by the
// process that owns the stage, so they can be compared across API, worker and browser.

import type { CompileDiagnostic } from '@/src/lib/compile-errors';

export type DocumentFormatValue = 'LATEX' | 'MARKDOWN';
export interface SnapshotAsset { path: string; mediaType: string; data: string; }

export interface SnapshotFileRef {
  path: string;
  checksum: string;
  revision: number;
  storageKey?: string | null;
}

export interface CompilationJob {
  id: string;
  documentId: string;
  userId: string;
  slug: string;
  /** Legacy single-source jobs. New jobs send snapshotDigest instead. */
  content?: string;
  format?: DocumentFormatValue;
  assets?: SnapshotAsset[];
  snapshotDigest?: string;
  mainFile?: string;
  createdAt: number;
  /** Wall clock of the HTTP request that enqueued the job. */
  requestedAt?: number;
}

export interface CompilationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
  diagnostics?: CompileDiagnostic[];
  logExcerpt?: string;
  warnings?: string;
  duration: number;
  timings?: StageTimings;
  fromCache?: boolean;
}

/** Monotonic durations measured inside the compiler process. */
export interface CompilerTimings {
  materializeMs: number;
  processSpawnMs: number;
  engineMs: number;
  pdfReadMs: number;
  totalMs: number;
  coldPackageCache?: boolean;
}

export interface StageTimings {
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
  compiler?: CompilerTimings;
}

export interface CompilationOptions {
  timeout?: number;
  cleanupOnError?: boolean;
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface JobStatusResponse {
  status: JobStatus;
  result?: {
    success: boolean;
    error?: string;
    diagnostics?: CompileDiagnostic[];
    logExcerpt?: string;
    warnings?: string;
    duration: number;
    pdfUrl?: string;
    fromCache?: boolean;
  };
  timings?: StageTimings;
  snapshot?: { digest: string; mainFile: string; files: SnapshotFileRef[] };
  createdAt: number;
  completedAt?: number;
  processingStartedAt?: number;
}
