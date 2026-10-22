export type DocumentFormatValue = 'LATEX' | 'MARKDOWN';

/** One local image asset embedded in the immutable job snapshot (base64). */
export interface SnapshotAsset {
  path: string;
  mediaType: string;
  data: string;
}

export interface CompilationJob {
  id: string;
  documentId: string;
  userId: string;
  slug: string;
  content: string;
  /** Server-derived at enqueue time from the owned document row. */
  format: DocumentFormatValue;
  /** Local assets for the snapshot; Markdown jobs only. */
  assets?: SnapshotAsset[];
  createdAt: number;
}

export interface CompilationResult {
  success: boolean;
  pdfBuffer?: Buffer;
  error?: string;
  warnings?: string;
  duration: number;
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
    warnings?: string;
    duration: number;
    pdfUrl?: string;
  };
  createdAt: number;
  completedAt?: number;
}