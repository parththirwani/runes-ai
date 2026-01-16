export interface CompilationJob {
  id: string;
  documentId: string;
  userId: string;
  slug: string;
  content: string;
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