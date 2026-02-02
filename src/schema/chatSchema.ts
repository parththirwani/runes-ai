import { z } from "zod";

export const chatSchema = z.object({
  message: z.string().min(1, "Message cannot be empty").max(5000),
  documentId: z.string().uuid("Invalid document ID"),
});

export type ChatInput = z.infer<typeof chatSchema>;