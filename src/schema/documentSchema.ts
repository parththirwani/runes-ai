import {z} from "zod"

export const documentSchema = z.object({
    title : z.string().min(1, "Title is required").max(30,"Title cant be longer than 30 chars"),
    content: z.string().min(1, "Content is required")
})

export const updateDocumentSchema = documentSchema.partial()