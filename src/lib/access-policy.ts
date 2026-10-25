// Pure access policy for workspaces and documents.
//
// This module has no database or framework imports on purpose: the whole permission matrix
// from docs/workspaces-teams-access-plan.md is decided here from a plain fact object, so
// every actor in the matrix can be unit tested and every route goes through the same rules.
// `src/lib/access.ts` loads the facts and enforces the outcome.
//
// Terminology: a `Workspace` is a COLLECTION OF DOCUMENTS. `WorkspaceFile` is a file inside
// one document and is not modelled here.

export type WorkspaceKind = "PERSONAL" | "TEAM";
export type TeamRole = "ADMIN" | "MEMBER";
export type GrantPermission = "VIEW" | "EDIT";

/** How the signed-in user reached this document, used for UI labels and audit messages. */
export type AccessSource =
  | "author"
  | "document-grant"
  | "workspace-grant"
  | "team-member"
  | "admin-inspection"
  | null;

export type GrantFact = {
  permission: GrantPermission;
  /** Acceptance is what activates a share; an untouched invitation grants nothing. */
  accepted: boolean;
  revoked: boolean;
};

export type TeamMembershipFact = {
  role: TeamRole;
  active: boolean;
};

export type DocumentFacts = {
  viewerId: string;
  authorId: string;
  workspaceKind: WorkspaceKind;
  /** Owning user of the containing workspace, for PERSONAL workspaces. */
  workspaceOwnerUserId: string | null;
  /** Team of the containing workspace, for TEAM workspaces. */
  workspaceTeamId: string | null;
  isAdmin: boolean;
  /** True only when the request came through an audited admin inspection endpoint. */
  adminInspection?: boolean;
  documentGrant: GrantFact | null;
  /** Grant on the containing personal workspace; covers current and future documents. */
  workspaceGrant: GrantFact | null;
  /** Membership of the viewer in the document's team, when the workspace is a team one. */
  teamMembership: TeamMembershipFact | null;
  /** Membership of the author, so a removed author keeps attribution but loses the team door. */
  authorTeamMembership: TeamMembershipFact | null;
};

export type DocumentCapabilities = {
  canRead: boolean;
  canEdit: boolean;
  canShare: boolean;
  canMove: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  authorId: string;
  access: AccessSource;
};

export type WorkspaceFacts = {
  viewerId: string;
  kind: WorkspaceKind;
  ownerUserId: string | null;
  teamId: string | null;
  isAdmin: boolean;
  grant: GrantFact | null;
  teamMembership: TeamMembershipFact | null;
};

export type WorkspaceCapabilities = {
  canRead: boolean;
  canCreate: boolean;
  canRename: boolean;
  /** Personal workspace owners share; team membership alone never shares. */
  canShare: boolean;
  canManageTeam: boolean;
  isAdmin: boolean;
  authorOnlyWrites: boolean;
  access: AccessSource;
};

/** A grant only counts while it is accepted and not revoked, and never as EDIT in v1. */
function usableGrant(grant: GrantFact | null, allowed: GrantPermission[]): boolean {
  return Boolean(grant && grant.accepted && !grant.revoked && allowed.includes(grant.permission));
}

function active(membership: TeamMembershipFact | null): boolean {
  return Boolean(membership && membership.active);
}

/**
 * The permission matrix, one document at a time.
 *
 * | Actor                        | read | edit | share |
 * | ---------------------------- | ---- | ---- | ----- |
 * | author with workspace access | yes  | yes  | yes   |
 * | accepted document recipient  | yes  | no   | no    |
 * | accepted workspace recipient | yes  | no   | no    |
 * | active team member           | yes  | no   | no    |
 * | team admin (other's doc)     | yes  | no   | no    |
 * | app admin via inspection     | yes  | no   | no    |
 * | pending invitee / stranger   | no   | no   | no    |
 */
export function decideDocumentAccess(facts: DocumentFacts): DocumentCapabilities {
  const isAuthor = facts.viewerId === facts.authorId;
  const isAdmin = facts.isAdmin;

  // The author needs a live door into the workspace that holds the document: their own
  // personal workspace, or an active membership in the team that owns the team workspace.
  const authorWorkspaceAccess = isAuthor
    ? facts.workspaceKind === "TEAM"
      ? active(facts.authorTeamMembership)
      : facts.workspaceOwnerUserId === facts.authorId
    : false;

  const directGrant = usableGrant(facts.documentGrant, ["VIEW"]);
  const workspaceGrant =
    facts.workspaceKind === "PERSONAL" && facts.workspaceOwnerUserId !== facts.viewerId
      ? usableGrant(facts.workspaceGrant, ["VIEW"])
      : false;
  const teamRead = facts.workspaceKind === "TEAM" && active(facts.teamMembership);
  const adminRead = Boolean(isAdmin && facts.adminInspection);

  const canRead = authorWorkspaceAccess || directGrant || workspaceGrant || teamRead || adminRead;

  let access: AccessSource = null;
  if (authorWorkspaceAccess) access = "author";
  else if (directGrant) access = "document-grant";
  else if (workspaceGrant) access = "workspace-grant";
  else if (teamRead) access = "team-member";
  else if (adminRead) access = "admin-inspection";

  // v1 editing is author-only, and a general editor route must not treat admin inspection
  // or team adminship as author access.
  const canEdit = canRead && isAuthor && authorWorkspaceAccess;

  return {
    canRead,
    canEdit,
    canShare: canEdit,
    canMove: canEdit,
    canDelete: canEdit,
    isAdmin,
    authorId: facts.authorId,
    access: canRead ? access : null,
  };
}

/**
 * Workspace-level capabilities. A personal workspace owner may create, rename and share.
 * An active team member may read and create, and only team admins manage members. A share
 * recipient reads only.
 */
export function decideWorkspaceAccess(facts: WorkspaceFacts): WorkspaceCapabilities | null {
  const isOwner = facts.kind === "PERSONAL" && facts.ownerUserId === facts.viewerId;
  const isTeamMember = facts.kind === "TEAM" && active(facts.teamMembership);
  const grantRead =
    facts.kind === "PERSONAL" && facts.ownerUserId !== facts.viewerId
      ? usableGrant(facts.grant, ["VIEW"])
      : false;
  const isAdmin = facts.isAdmin;

  if (!isOwner && !isTeamMember && !grantRead && !isAdmin) return null;

  let access: AccessSource = null;
  if (isOwner) access = "author";
  else if (isTeamMember) access = "team-member";
  else if (grantRead) access = "workspace-grant";
  else if (isAdmin) access = "admin-inspection";

  const canCreate = isOwner || isTeamMember;

  return {
    canRead: isOwner || isTeamMember || grantRead || isAdmin,
    canCreate,
    canRename: isOwner || (isTeamMember && facts.teamMembership?.role === "ADMIN"),
    canShare: isOwner,
    canManageTeam: isTeamMember ? facts.teamMembership?.role === "ADMIN" : isAdmin,
    isAdmin,
    // Every document write inside a team workspace stays with that document's author.
    authorOnlyWrites: true,
    access,
  };
}

/** A removed member may still be the author of documents in the team workspace. */
export function removedAuthorKeepsAttribution(facts: DocumentFacts): boolean {
  return facts.viewerId === facts.authorId && !active(facts.authorTeamMembership);
}
