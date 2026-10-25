import { z } from "zod";

export const INVITATION_ROLE_VALUES = ["ADMIN", "MEMBER"] as const;

export const shareEmailSchema = z.object({
  email: z.string().trim().min(3).max(254),
});

export const shareRevokeSchema = z.object({
  kind: z.enum(["invitation", "workspace-grant", "document-grant"]),
  id: z.string().min(1).max(64),
});

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(40),
});

export const renameWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(40),
});

export const workspaceDocumentCreateSchema = z.object({
  title: z.string().min(1).max(30),
  format: z.enum(["LATEX", "MARKDOWN"]).optional(),
  content: z.string().max(1_000_000).optional(),
});

export const moveDocumentSchema = z.object({
  workspaceId: z.string().min(1).max(64),
});

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export const inviteTeamMemberSchema = z.object({
  email: z.string().trim().min(3).max(254),
  role: z.enum(INVITATION_ROLE_VALUES).default("MEMBER"),
});

export const removeTeamMemberSchema = z.object({
  memberId: z.string().min(1).max(64),
});

export const changeTeamRoleSchema = z.object({
  memberId: z.string().min(1).max(64),
  role: z.enum(INVITATION_ROLE_VALUES),
});

export const adminListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
