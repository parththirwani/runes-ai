-- Workspaces, teams, sharing, and administration: additive stage.
--
-- Nothing here removes or rewrites existing document data. `documents."workspaceId"`
-- is added nullable and is only made required by the follow-up migration
-- 20261025190100_workspace_backfill, after the backfill has assigned every document.

-- CreateEnum
CREATE TYPE "WorkspaceKind" AS ENUM ('PERSONAL', 'TEAM');
CREATE TYPE "TeamRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE "InvitationTarget" AS ENUM ('TEAM', 'WORKSPACE', 'DOCUMENT');
-- EDIT is reserved for a later release; no v1 route issues or honors it.
CREATE TYPE "GrantPermission" AS ENUM ('VIEW', 'EDIT');

-- AlterTable: app-wide administrator flag, provisioned only by a controlled operation.
ALTER TABLE "users" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: nullable collection-workspace pointer, backfilled then made required.
ALTER TABLE "documents" ADD COLUMN "workspaceId" TEXT;
CREATE INDEX "documents_workspaceId_idx" ON "documents"("workspaceId");

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkspaceKind" NOT NULL,
    "ownerUserId" TEXT,
    "teamId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspaces_exactly_one_owner" CHECK (
        ("ownerUserId" IS NULL) <> ("teamId" IS NULL)
    )
);

-- Exactly one default personal workspace per owner, enforced in SQL because Prisma
-- cannot express a partial unique constraint.
CREATE UNIQUE INDEX "workspaces_one_default_personal_per_owner"
    ON "workspaces"("ownerUserId")
    WHERE "kind" = 'PERSONAL' AND "isDefault" IS TRUE AND "ownerUserId" IS NOT NULL;

-- Exactly one default team workspace per team.
CREATE UNIQUE INDEX "workspaces_one_default_team_per_team"
    ON "workspaces"("teamId")
    WHERE "kind" = 'TEAM' AND "isDefault" IS TRUE AND "teamId" IS NOT NULL;

CREATE INDEX "workspaces_ownerUserId_idx" ON "workspaces"("ownerUserId");
CREATE INDEX "workspaces_teamId_idx" ON "workspaces"("teamId");

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "target" "InvitationTarget" NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "inviterId" TEXT NOT NULL,
    "teamId" TEXT,
    "workspaceId" TEXT,
    "documentId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invitations_exactly_one_target" CHECK (
        (
            ("teamId" IS NOT NULL)::int
            + ("workspaceId" IS NOT NULL)::int
            + ("documentId" IS NOT NULL)::int
        ) = 1
    )
);

CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- One active invitation per target and normalized email. The expression form keeps
-- the rule enforceable on PostgreSQL versions without NULLS NOT DISTINCT.
CREATE UNIQUE INDEX "invitations_one_active_per_target_and_email"
    ON "invitations" (
        "email",
        "target",
        COALESCE("teamId", ''),
        COALESCE("workspaceId", ''),
        COALESCE("documentId", '')
    )
    WHERE "status" = 'PENDING';

CREATE INDEX "invitations_email_status_idx" ON "invitations"("email", "status");
CREATE INDEX "invitations_teamId_idx" ON "invitations"("teamId");
CREATE INDEX "invitations_workspaceId_idx" ON "invitations"("workspaceId");
CREATE INDEX "invitations_documentId_idx" ON "invitations"("documentId");

-- CreateTable
CREATE TABLE "workspace_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "permission" "GrantPermission" NOT NULL DEFAULT 'VIEW',
    "invitedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_grants_workspaceId_recipientId_key" ON "workspace_grants"("workspaceId", "recipientId");
CREATE INDEX "workspace_grants_recipientId_idx" ON "workspace_grants"("recipientId");

-- CreateTable
CREATE TABLE "document_grants" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "permission" "GrantPermission" NOT NULL DEFAULT 'VIEW',
    "invitedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_grants_documentId_recipientId_key" ON "document_grants"("documentId", "recipientId");
CREATE INDEX "document_grants_recipientId_idx" ON "document_grants"("recipientId");

-- CreateTable
CREATE TABLE "admin_audit_events" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "teamId" TEXT,
    "workspaceId" TEXT,
    "documentId" TEXT,
    "targetUserId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_events_teamId_createdAt_idx" ON "admin_audit_events"("teamId", "createdAt");
CREATE INDEX "admin_audit_events_actorId_createdAt_idx" ON "admin_audit_events"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviterId_fkey" FOREIGN KEY ("inviterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_grants" ADD CONSTRAINT "workspace_grants_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "admin_audit_events" ADD CONSTRAINT "admin_audit_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
