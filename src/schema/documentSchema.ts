import { z } from "zod";

export const DOCUMENT_FORMAT_VALUES = ["LATEX", "MARKDOWN"] as const;
export const documentFormatSchema = z.enum(DOCUMENT_FORMAT_VALUES);
export const MAX_DOCUMENT_CONTENT_CHARS = 1_000_000;
export const createDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(30, "Title cant be longer than 30 chars"),
  content: z.string().min(1, "Content is required").max(MAX_DOCUMENT_CONTENT_CHARS, "Content is too large").optional(),
  format: documentFormatSchema.optional(),
});
export const updateDocumentSchema = z.object({
  title: z.string().min(1, "Title is required").max(30, "Title cant be longer than 30 chars").optional(),
  content: z.string().min(1, "Content is required").max(MAX_DOCUMENT_CONTENT_CHARS, "Content is too large").optional(),
}).strict();
export const documentSchema = createDocumentSchema;

// Multi file save. baseRevision gives the client optimistic conflict detection.
export const workspaceSaveSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        content: z.string().max(1024 * 1024),
        baseRevision: z.number().int().positive().nullable().optional(),
      }),
    )
    .max(100)
    .optional(),
});

export const workspaceUpdateSchema = updateDocumentSchema.extend({
  files: workspaceSaveSchema.shape.files,
});

export const workspaceFileWriteSchema = z.object({
  path: z.string().min(1).max(300),
  content: z.string().max(1024 * 1024),
  baseRevision: z.number().int().positive().nullable().optional(),
});

export const workspaceMoveSchema = z.object({
  from: z.string().min(1).max(300),
  to: z.string().min(1).max(300),
});

export const workspaceMainSchema = z.object({
  path: z.string().min(1).max(300),
});
