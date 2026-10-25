-- Workspaces, teams, sharing and administration.
--
-- This migration is strictly additive: it creates the new tables, the app-admin flag and a
-- NULLABLE documents."workspaceId". Nothing is moved yet and no old constraint is dropped,
-- so application code that predates this release keeps working against the new schema.
-- The backfill and the constraint swap live in the next migration, which is the only step
-- that touches existing rows.

-- CreateEnum
CREATE TYPE "WorkspaceKind" AS ENUM ('PERSONAL', 'TEAM');
CREATE TYPE "TeamMemberRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "GrantPermission" AS ENUM ('VIEW', 'EDIT');
CREATE TYPE "InvitationTarget" AS ENUM ('TEAM', 'WORKSPACE', 'DOCUMENT');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkspaceKind" NOT NULL,
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "permission" "GrantPermission" NOT NULL DEFAULT 'VIEW',
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_grants" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "permission" "GrantPermission" NOT NULL DEFAULT 'VIEW',
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "target" "InvitationTarget" NOT NULL,
    "targetEmail" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "teamId" TEXT,
    "workspaceId" TEXT,
    "documentId" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "admin_audit_events" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "teamId" TEXT,
    "workspaceId" TEXT,
    "documentId" TEXT,
    "targetUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

-- AlterTable: nullable first so the backfill can run before the column becomes required.
ALTER TABLE "documents" ADD COLUMN "workspaceId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "teams_name_key" ON "teams"("name");
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");
CREATE UNIQUE INDEX "workspaces_ownerUserId_name_key" ON "workspaces"("ownerUserId", "name");
CREATE UNIQUE INDEX "workspaces_teamId_name_key" ON "workspaces"("teamId", "name");
CREATE INDEX "workspaces_ownerUserId_idx" ON "workspaces"("ownerUserId");
CREATE INDEX "workspaces_teamId_idx" ON "workspaces"("teamId");
CREATE UNIQUE INDEX "workspace_grants_workspaceId_recipientUserId_key" ON "workspace_grants"("workspaceId", "recipientUserId");
CREATE INDEX "workspace_grants_recipientUserId_idx" ON "workspace_grants"("recipientUserId");
CREATE UNIQUE INDEX "document_grants_documentId_recipientUserId_key" ON "document_grants"("documentId", "recipientUserId");
CREATE INDEX "document_grants_recipientUserId_idx" ON "document_grants"("recipientUserId");
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");
CREATE INDEX "invitations_targetEmail_status_idx" ON "invitations"("targetEmail", "status");
CREATE INDEX "invitations_teamId_idx" ON "invitations"("teamId");
CREATE INDEX "invitations_workspaceId_idx" ON "invitations"("workspaceId");
CREATE INDEX "invitations_documentId_idx" ON "invitations"("documentId");
CREATE INDEX "admin_audit_events_createdAt_idx" ON "admin_audit_events"("createdAt");
CREATE INDEX "admin_audit_events_teamId_idx" ON "admin_audit_events"("teamId");
CREATE INDEX "admin_audit_events_actorUserId_idx" ON "admin_audit_events"("actorUserId");
CREATE INDEX "documents_workspaceId_idx" ON "documents"("workspaceId");

-- Exactly one owner type per workspace, and one target type per invitation. Prisma cannot
-- express these, so they are enforced in SQL.
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_single_owner_type"
  CHECK (("ownerUserId" IS NULL) <> ("teamId" IS NULL));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_single_target"
  CHECK ((("teamId" IS NOT NULL)::int + ("workspaceId" IS NOT NULL)::int + ("documentId" IS NOT NULL)::int) = 1);
-- "One default personal workspace per owner" and "one default team workspace per team" are
-- partial unique indexes: Prisma cannot express a constrained uniqueness rule, and the
-- plain indexes above deliberately allow extra non-default workspaces to exist.
CREATE UNIQUE INDEX "workspaces_owner_default_key" ON "workspaces"("ownerUserId")
  WHERE "kind" = 'PERSONAL' AND "isDefault" = true AND "ownerUserId" IS NOT NULL;
CREATE UNIQUE INDEX "workspaces_team_default_key" ON "workspaces"("teamId")
  WHERE "kind" = 'TEAM' AND "isDefault" = true AND "teamId" IS NOT NULL;

-- At most one live invitation per recipient address and target. Revoked, expired and
-- accepted rows keep their history; a resend inserts only after the old row is closed out.
CREATE UNIQUE INDEX "invitations_live_target_key" ON "invitations"("targetEmail", COALESCE("teamId", ''), COALESCE("workspaceId", ''), COALESCE("documentId", ''))
  WHERE "status" = 'PENDING' AND "revokedAt" IS NULL;

-- Only one active membership row per user per team, so removing and re-inviting a member
-- reuses the row instead of creating a second grant of access.
CREATE UNIQUE INDEX "team_members_active_key" ON "team_members"("teamId", "userId")
  WHERE "active" = true;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
