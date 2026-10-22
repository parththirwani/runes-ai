import {z} from "zod"

export const DOCUMENT_FORMAT_VALUES = ["LATEX", "MARKDOWN"] as const

export const documentFormatSchema = z.enum(DOCUMENT_FORMAT_VALUES)

export const MAX_DOCUMENT_CONTENT_CHARS = 1_000_000

export const createDocumentSchema = z.object({
    title : z.string().min(1, "Title is required").max(30,"Title cant be longer than 30 chars"),
    content: z.string().min(1, "Content is required").max(MAX_DOCUMENT_CONTENT_CHARS, "Content is too large").optional(),
    // New clients must send an explicit format. During the transition a
    // missing format is treated as LATEX (the only format that existed before).
    format: documentFormatSchema.optional(),
})

// Update payloads may never change format: strict() rejects the key outright
// so a rename can not convert a document.
export const updateDocumentSchema = z.object({
    title: z.string().min(1, "Title is required").max(30,"Title cant be longer than 30 chars").optional(),
    content: z.string().min(1, "Content is required").max(MAX_DOCUMENT_CONTENT_CHARS, "Content is too large").optional(),
}).strict()

/** @deprecated Kept for existing imports; use createDocumentSchema. */
export const documentSchema = createDocumentSchema
