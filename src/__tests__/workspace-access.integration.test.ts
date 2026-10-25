// Database integration and five-actor API tests.
//
// These run only when DATABASE_URL_TEST points at a throwaway PostgreSQL database, because the
// plan requires the real constraints: the partial unique indexes, the workspace foreign key, and
// the serializable transactions behind invitations and moves cannot be proved against a mock.
// Without that variable the file skips itself, so the default suite stays database-free.
//
// Nothing application-side is imported statically: the Prisma client reads DATABASE_URL the first
// time its module loads, so every app import happens inside `beforeAll`, after the URL has been
// switched to the test database. That is what keeps a misconfigured run from touching real data.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

const testUrl = process.env.DATABASE_URL_TEST ?? "";
const describeDb = describe.skipIf(testUrl.length === 0);

const actor = vi.hoisted(() => ({ current: null as null | { id: string; email: string } }));

vi.mock("@/src/lib/auth", () => ({
  auth: async () =>
    actor.current
      ? { user: { id: actor.current.id, email: actor.current.email, name: actor.current.email }, expires: new Date(Date.now() + 60_000).toISOString() }
      : null,
  handlers: {},
  signIn: async () => undefined,
  signOut: async () => undefined,
}));

// The compile worker and Redis are out of scope here. What matters is who may enqueue a build and
// who may read one, so the producer is replaced with an instrumented stand-in.
const producer = vi.hoisted(() => ({
  addJob: vi.fn(async () => "job-1"),
  addSnapshotJob: vi.fn(async () => ({ jobId: "job-1", reused: "new" as const })),
  recordDocumentJob: vi.fn(async () => undefined),
  documentJobIds: vi.fn(async () => [] as string[]),
  getJobStatus: vi.fn(async () => null as unknown),
  getPDF: vi.fn(async () => null as unknown),
  getRawJobData: vi.fn(async () => null as string | null),
}));

vi.mock("@/producer/queue", () => ({ compilationProducer: producer }));

// Compiles are rate limited through a Redis counter, which says nothing about who may compile.
vi.mock("@/src/lib/rateLimit", () => ({
  checkRateLimit: async () => ({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }),
}));

/* eslint-disable @typescript-eslint/no-explicit-any */
type Client = any;

let prisma: Client;
let services: Record<string, any>;
let routes: Record<string, any>;
const ids: Record<string, string> = {};

function url(path: string): string {
  return "http://localhost" + path;
}

type NextInit = ConstructorParameters<typeof NextRequest>[1];

function req(path: string, init?: NextInit): NextRequest {
  return new NextRequest(url(path), init);
}

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}

async function actAs(name: string): Promise<void> {
  actor.current = { id: ids[name], email: name + "@workspace-it.test" };
}

function tokenOf(delivery: unknown): string {
  const value = delivery as { channel?: string; path?: string };
  if (value?.channel !== "development-link" || !value.path) throw new Error("expected a development invite link");
  return value.path.split("/").pop() as string;
}

async function acceptByEmail(token: string, email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return services.acceptInvitation(prisma, token, user.id, email);
}

async function grantDocument(documentId: string, email: string): Promise<void> {
  const invitation = await services.shareDocument(prisma, ids.author, documentId, email);
  await acceptByEmail(tokenOf(invitation.delivery), email);
}

async function grantWorkspace(workspaceId: string, email: string): Promise<void> {
  const invitation = await services.shareWorkspace(prisma, ids.author, workspaceId, email);
  await acceptByEmail(tokenOf(invitation.delivery), email);
}

async function revokeDocumentShare(documentId: string, recipientId: string): Promise<void> {
  const grant = await prisma.documentGrant.findFirst({ where: { documentId, recipientId } });
  if (!grant) throw new Error("expected an accepted document grant for " + recipientId);
  await services.revokeShare(prisma, ids.author, { kind: "document-grant", id: grant.id });
}

async function wipe(client: Client): Promise<void> {
  await client.adminAuditEvent.deleteMany();
  await client.documentGrant.deleteMany();
  await client.workspaceGrant.deleteMany();
  await client.invitation.deleteMany();
  await client.teamMember.deleteMany();
  // Message and ChatSession have cascade relations from Document, so they go first.
  await client.message.deleteMany();
  await client.chatSession.deleteMany();
  await client.document.deleteMany();
  await client.workspace.deleteMany();
  await client.team.deleteMany();
  await client.user.deleteMany();
}

async function addFile(documentId: string, content: string): Promise<void> {
  await prisma.workspaceFile.create({
    data: {
      documentId,
      path: "main.md",
      kind: "other",
      mimeType: "text/markdown",
      sizeBytes: Buffer.byteLength(content, "utf-8"),
      checksum: createHash("sha256").update(content).digest("hex"),
      revision: 1,
      content,
    },
  });
}

async function seed(): Promise<void> {
  for (const name of ["author", "reader", "stranger", "teamadmin", "appadmin"]) {
    const user = await prisma.user.create({
      data: { email: name + "@workspace-it.test", firstName: name, lastName: "Test", isAdmin: name === "appadmin" },
      select: { id: true },
    });
    ids[name] = user.id;
  }

  ids.paper = (await services.createDocumentInWorkspace(prisma, ids.author, null, { title: "Paper", format: "MARKDOWN" })).id;
  ids.lab = (await services.createPersonalWorkspace(prisma, ids.author, "Lab Notes")).id;
  ids.labDoc = (await services.createDocumentInWorkspace(prisma, ids.author, ids.lab, { title: "Lab entry", format: "MARKDOWN" })).id;
  ids.readerDoc = (await services.createDocumentInWorkspace(prisma, ids.reader, null, { title: "Reader own note", format: "MARKDOWN" })).id;

  // Files are seeded directly: a reader's access must be testable against bytes that already
  // exist, without first running the author-only lazy migration.
  await addFile(ids.paper, "# Paper\n\nBody text for the integration run.\n");
  await addFile(ids.labDoc, "# Lab entry\n");
  await addFile(ids.readerDoc, "# Reader own note\n");

  const team = await services.createTeam(prisma, ids.appadmin, "Research");
  ids.team = team.teamId;
  ids.teamWorkspace = team.workspaceId;
  await prisma.teamMember.create({ data: { teamId: ids.team, userId: ids.teamadmin, role: "ADMIN" } });
  // The author is a plain member too: moving a document into a team workspace requires it.
  await prisma.teamMember.create({ data: { teamId: ids.team, userId: ids.author, role: "MEMBER" } });

  ids.teamDoc = (
    await prisma.document.create({
      data: {
        title: "Team shared draft",
        slug: "team-shared-draft",
        content: "# Team shared draft\n",
        format: "MARKDOWN",
        mainFilePath: "main.md",
        userId: ids.author,
        workspaceId: ids.teamWorkspace,
      },
      select: { id: true },
    })
  ).id;
  await addFile(ids.teamDoc, "# Team shared draft\n");
}

beforeAll(async () => {
  if (testUrl.length === 0) return;
  process.env.DATABASE_URL = testUrl;
  delete process.env.INVITE_EMAIL_WEBHOOK_URL;

  prisma = (await import("@/src/lib/db")).prisma;
  services = {
    ...(await import("@/src/lib/workspaces")),
    ...(await import("@/src/lib/teams")),
    ...(await import("@/src/lib/invitations")),
    ...(await import("@/src/lib/workspace-ownership")),
    ...(await import("@/src/lib/admin")),
  };
  routes = {
    library: await import("@/src/app/api/document/route"),
    bySlug: await import("@/src/app/api/document/[slug]/route"),
    bySlugFile: await import("@/src/app/api/document/[slug]/file/route"),
    bySlugMain: await import("@/src/app/api/document/[slug]/main/route"),
    bySlugUpload: await import("@/src/app/api/document/[slug]/upload/route"),
    byId: await import("@/src/app/api/documents/[id]/route"),
    byIdPdf: await import("@/src/app/api/documents/[id]/pdf/route"),
    byIdShares: await import("@/src/app/api/documents/[id]/shares/route"),
    workspaces: await import("@/src/app/api/workspaces/route"),
    workspaceDocuments: await import("@/src/app/api/workspaces/[id]/documents/route"),
    job: await import("@/src/app/api/job/[jobId]/route"),
    adminTeams: await import("@/src/app/api/admin/teams/route"),
    adminAudit: await import("@/src/app/api/admin/audit/route"),
    adminInspect: await import("@/src/app/api/admin/documents/[id]/inspect/route"),
  };

  await wipe(prisma);
  await seed();
}, 180_000);

afterAll(async () => {
  if (testUrl.length === 0 || !prisma) return;
  await wipe(prisma);
  await prisma.$disconnect();
});

beforeEach(async () => {
  if (testUrl.length === 0) return;
  actor.current = null;
  producer.addJob.mockClear();
  producer.documentJobIds.mockResolvedValue([]);
  producer.getJobStatus.mockResolvedValue(null);
  producer.getPDF.mockResolvedValue(null);
  producer.getRawJobData.mockResolvedValue(null);
  // Every mutation test starts from the same accepted document share for the reader.
  await grantDocument(ids.paper, "reader@workspace-it.test");
});

describeDb("workspaces, shares, teams, and admin against PostgreSQL", () => {
  it("puts every document in exactly one workspace and stays repeatable", async () => {
    const rows = await prisma.document.findMany({ select: { id: true, userId: true, workspaceId: true } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row: { workspaceId: string | null }) => Boolean(row.workspaceId))).toBe(true);

    const first = await services.applyOwnershipBackfill(prisma);
    // Three seeded accounts have never signed in, so they gain the default workspace here.
    expect(first.createdDefaultWorkspaces).toBe(3);
    expect(first.assignedDocuments).toBe(0);
    expect(first.counts.unassignedDocuments).toBe(0);
    expect(first.problems).toEqual([]);

    // A second run changes nothing at all, which is what makes the script safe to re-run.
    const stable = JSON.stringify(await services.verifyOwnership(prisma));
    const again = await services.applyOwnershipBackfill(prisma);
    expect(again.createdDefaultWorkspaces).toBe(0);
    expect(again.assignedDocuments).toBe(0);
    expect(JSON.stringify(await services.verifyOwnership(prisma))).toBe(stable);
  });

  it("creates one default personal workspace even under concurrent sign-ins", async () => {
    const user = await prisma.user.create({ data: { email: "concurrent@workspace-it.test" }, select: { id: true } });
    const results = await Promise.all([
      services.ensureDefaultPersonalWorkspace(prisma, user.id),
      services.ensureDefaultPersonalWorkspace(prisma, user.id),
      services.ensureDefaultPersonalWorkspace(prisma, user.id),
    ]);
    expect(new Set(results.map((row: { workspaceId: string }) => row.workspaceId)).size).toBe(1);
    expect(await prisma.workspace.count({ where: { ownerUserId: user.id, kind: "PERSONAL", isDefault: true } })).toBe(1);
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("refuses a duplicate title in one workspace and allows the same title in another", async () => {
    await expect(services.createDocumentInWorkspace(prisma, ids.author, ids.lab, { title: "Lab entry", format: "MARKDOWN" })).rejects.toMatchObject({ status: 409 });
    const elsewhere = await services.createDocumentInWorkspace(prisma, ids.author, null, { title: "Lab entry", format: "MARKDOWN" });
    expect(elsewhere.workspaceId).not.toBe(ids.lab);
  });

  it("moves an authored document and tells the author who gains access", async () => {
    await actAs("author");
    const preview = await services.describeMove(prisma, ids.author, ids.labDoc, ids.teamWorkspace);
    expect(preview.grantsTeamAccess).toBe(true);

    const moved = await services.moveDocument(prisma, ids.author, ids.labDoc, ids.teamWorkspace);
    expect(moved.toWorkspaceId).toBe(ids.teamWorkspace);
    expect((await prisma.document.findUnique({ where: { id: ids.labDoc }, select: { workspaceId: true } }))?.workspaceId).toBe(ids.teamWorkspace);

    // The team door is what the move opened.
    await actAs("teamadmin");
    expect((await routes.byId.GET(req("/api/documents/" + ids.labDoc), ctx({ id: ids.labDoc }))).status).toBe(200);

    await actAs("author");
    const back = await services.moveDocument(prisma, ids.author, ids.labDoc, ids.lab);
    expect(back.fromWorkspaceId).toBe(ids.teamWorkspace);
  });

  it("lets a team admin read the team workspace but not rewrite someone else's document", async () => {
    await actAs("teamadmin");
    expect((await services.listTeamMembers(prisma, ids.teamadmin, ids.team)).length).toBeGreaterThanOrEqual(2);

    const read = await routes.byId.GET(req("/api/documents/" + ids.teamDoc), ctx({ id: ids.teamDoc }));
    expect(read.status).toBe(200);
    const payload = await read.json();
    expect(payload.capabilities.canRead).toBe(true);
    expect(payload.capabilities.canEdit).toBe(false);

    const write = await routes.bySlug.PUT(
      req("/api/document/team-shared-draft", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Hijacked" }) }),
      ctx({ slug: "team-shared-draft" }),
    );
    expect(write.status).toBe(404);
  });

  it("keeps the last active admin of a team", async () => {
    const solo = await services.createTeam(prisma, ids.appadmin, "Solo Crew");
    const members = await services.listTeamMembers(prisma, ids.appadmin, solo.teamId);
    const sole = members.find((member: { role: string; active: boolean }) => member.active && member.role === "ADMIN");

    // The only admin cannot lock the team out of itself.
    await expect(services.removeTeamMember(prisma, ids.appadmin, solo.teamId, sole.id)).rejects.toMatchObject({ status: 409 });

    // Once another admin exists, leaving is allowed and the team keeps one admin.
    await prisma.teamMember.create({ data: { teamId: solo.teamId, userId: ids.teamadmin, role: "ADMIN" } });
    expect((await services.removeTeamMember(prisma, ids.appadmin, solo.teamId, sole.id)).removedUserId).toBe(ids.appadmin);
    const left = await services.listTeamMembers(prisma, ids.appadmin, solo.teamId);
    expect(left.filter((member: { role: string; active: boolean }) => member.active && member.role === "ADMIN")).toHaveLength(1);
  });

  it("grants nothing until the named person accepts, and cuts access on revocation", async () => {
    const email = "pending@workspace-it.test";
    const invitation = await services.shareDocument(prisma, ids.author, ids.paper, email);
    const token = tokenOf(invitation.delivery);
    const outsider = await prisma.user.create({ data: { email }, select: { id: true, email: true } });

    // A pending invitation is not access yet, for anybody.
    actor.current = { id: outsider.id, email: outsider.email };
    expect((await routes.bySlug.GET(req("/api/document/paper"), ctx({ slug: "paper" }))).status).toBe(404);

    expect((await services.previewInvitation(prisma, token, "somebody.else@workspace-it.test")).state).toBe("wrong-email");

    const accepted = await acceptByEmail(token, email);
    expect(accepted.alreadyAccepted).toBe(false);
    expect((await acceptByEmail(token, email)).alreadyAccepted).toBe(true);

    const read = await routes.bySlug.GET(req("/api/document/paper"), ctx({ slug: "paper" }));
    expect(read.status).toBe(200);
    expect((await read.json()).document.access.canEdit).toBe(false);

    await revokeDocumentShare(ids.paper, ids.reader);
    await revokeDocumentShare(ids.paper, outsider.id);
    actor.current = { id: outsider.id, email: outsider.email };
    expect((await routes.bySlug.GET(req("/api/document/paper"), ctx({ slug: "paper" }))).status).toBe(404);
    await prisma.user.delete({ where: { id: outsider.id } });
  });

  it("refuses an unrelated account on every read and write surface", async () => {
    await actAs("stranger");
    const calls: [string, () => Promise<Response>][] = [
      ["read by id", () => routes.byId.GET(req("/api/documents/" + ids.paper), ctx({ id: ids.paper }))],
      ["read by legacy slug", () => routes.bySlug.GET(req("/api/document/paper"), ctx({ slug: "paper" }))],
      ["file read", () => routes.bySlugFile.GET(req("/api/document/paper/file?path=main.md"), ctx({ slug: "paper" }))],
      ["save", () => routes.bySlug.PUT(req("/api/document/paper", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "# x\n" }) }), ctx({ slug: "paper" }))],
      ["rename", () => routes.bySlug.PATCH(req("/api/document/paper", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Other" }) }), ctx({ slug: "paper" }))],
      ["upload", () => routes.bySlugUpload.POST(req("/api/document/paper/upload", { method: "POST", body: (() => { const form = new FormData(); form.append("file", new File(["x"], "main.md", { type: "text/markdown" })); form.append("path", "main.md"); return form; })() }), ctx({ slug: "paper" }))],
      ["main file change", () => routes.bySlugMain.POST(req("/api/document/paper/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "main.md" }) }), ctx({ slug: "paper" }))],
      ["compile dispatch", () => routes.bySlug.POST(req("/api/document/paper", { method: "POST" }), ctx({ slug: "paper" }))],
      ["delete", () => routes.bySlug.DELETE(req("/api/document/paper", { method: "DELETE" }), ctx({ slug: "paper" }))],
      ["document pdf", () => routes.byIdPdf.GET(req("/api/documents/" + ids.paper + "/pdf"), ctx({ id: ids.paper }))],
      ["share list", () => routes.byIdShares.GET(req("/api/documents/" + ids.paper + "/shares"), ctx({ id: ids.paper }))],
    ];

    for (const [label, call] of calls) {
      expect((await call()).status, label).toBe(404);
    }
    expect(producer.addJob).not.toHaveBeenCalled();
    expect((await (await routes.library.GET(req("/api/document"), {} as never)).json()).documents).toEqual([]);
  });

  it("keeps a shared reader on the read side of both the legacy and the id-based surface", async () => {
    await actAs("reader");
    expect((await routes.bySlug.GET(req("/api/document/paper"), ctx({ slug: "paper" }))).status).toBe(200);
    expect((await routes.bySlugFile.GET(req("/api/document/paper/file?path=main.md"), ctx({ slug: "paper" }))).status).toBe(200);

    const access = await routes.byId.GET(req("/api/documents/" + ids.paper), ctx({ id: ids.paper }));
    const payload = await access.json();
    expect(payload.capabilities.canRead).toBe(true);
    expect(payload.capabilities.canEdit).toBe(false);
    expect(payload.capabilities.canDelete).toBe(false);
    expect(payload.canonicalPath).toBe("/document/paper");

    const writes: [string, () => Promise<Response>][] = [
      ["save", () => routes.bySlug.PUT(req("/api/document/paper", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "# rewritten\n" }) }), ctx({ slug: "paper" }))],
      ["rename", () => routes.bySlug.PATCH(req("/api/document/paper", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Mine now" }) }), ctx({ slug: "paper" }))],
      ["favorite", () => routes.bySlug.PATCH(req("/api/document/paper", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isFavorite: true }) }), ctx({ slug: "paper" }))],
      ["main file change", () => routes.bySlugMain.POST(req("/api/document/paper/main", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "main.md" }) }), ctx({ slug: "paper" }))],
      ["compile dispatch", () => routes.bySlug.POST(req("/api/document/paper", { method: "POST" }), ctx({ slug: "paper" }))],
      ["delete", () => routes.bySlug.DELETE(req("/api/document/paper", { method: "DELETE" }), ctx({ slug: "paper" }))],
      ["share it onward", () => routes.byIdShares.POST(req("/api/documents/" + ids.paper + "/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "somebody@workspace-it.test" }) }), ctx({ id: ids.paper }))],
    ];

    for (const [label, call] of writes) {
      expect((await call()).status, label).toBe(404);
    }
    expect(producer.addJob).not.toHaveBeenCalled();
  });

  it("ties a job to the account that submitted it and answers a shared preview by document", async () => {
    await actAs("author");
    expect((await routes.bySlug.POST(req("/api/document/paper", { method: "POST" }), ctx({ slug: "paper" }))).status).toBe(202);
    expect(producer.addJob).toHaveBeenCalledOnce();
    producer.getRawJobData.mockResolvedValue(JSON.stringify({ userId: ids.author }));
    producer.getJobStatus.mockResolvedValue({ status: "completed", timings: { completedAt: Date.now() } });

    // A guessed or stale job id belongs to somebody else, so it is simply not there.
    await actAs("reader");
    expect((await routes.job.GET(req("/api/job/job-1"), ctx({ jobId: "job-1" }))).status).toBe(404);

    // The document-scoped read decides on the document, so the share is what carries the reader.
    producer.documentJobIds.mockResolvedValue(["job-1"]);
    producer.getPDF.mockResolvedValue(Buffer.from("%PDF-1.4 shared preview"));
    const shared = await routes.byIdPdf.GET(req("/api/documents/" + ids.paper + "/pdf"), ctx({ id: ids.paper }));
    expect(shared.status).toBe(200);
    expect(shared.headers.get("cache-control")).toContain("no-store");

    // Revoking closes the artifact too, without touching the cached job.
    await actAs("author");
    await revokeDocumentShare(ids.paper, ids.reader);
    await actAs("reader");
    expect((await routes.byIdPdf.GET(req("/api/documents/" + ids.paper + "/pdf"), ctx({ id: ids.paper }))).status).toBe(404);
  });

  it("treats a workspace share as the collection it is, current and future documents alike", async () => {
    await actAs("author");
    await grantWorkspace(ids.lab, "reader@workspace-it.test");

    await actAs("reader");
    const listed = await routes.workspaceDocuments.GET(req("/api/workspaces/" + ids.lab + "/documents"), ctx({ id: ids.lab }));
    expect(listed.status).toBe(200);
    expect((await listed.json()).documents.map((row: { slug: string }) => row.slug)).toContain("lab-entry");
    expect((await routes.byId.GET(req("/api/documents/" + ids.labDoc), ctx({ id: ids.labDoc }))).status).toBe(200);

    // A document created after the share needs no new invitation.
    await actAs("author");
    const later = await services.createDocumentInWorkspace(prisma, ids.author, ids.lab, { title: "Written after the share", format: "MARKDOWN" });
    await actAs("reader");
    const readLater = await routes.byId.GET(req("/api/documents/" + later.id), ctx({ id: later.id }));
    expect(readLater.status).toBe(200);
    expect((await readLater.json()).capabilities.canEdit).toBe(false);

    // One revocation closes the whole collection.
    await actAs("author");
    const grant = await prisma.workspaceGrant.findFirst({ where: { workspaceId: ids.lab, recipientId: ids.reader } });
    if (!grant) throw new Error("expected an accepted workspace grant for the reader");
    await services.revokeShare(prisma, ids.author, { kind: "workspace-grant", id: grant.id });
    await actAs("reader");
    expect((await routes.byId.GET(req("/api/documents/" + later.id), ctx({ id: later.id }))).status).toBe(404);
  });

  it("keeps an app administrator read-only, audited, and out of the generic document surface", async () => {
    await actAs("stranger");
    expect((await routes.adminTeams.GET(req("/api/admin/teams"), {} as never)).status).toBe(404);
    expect((await routes.adminAudit.GET(req("/api/admin/audit"), {} as never)).status).toBe(404);

    await actAs("appadmin");
    const teams = await routes.adminTeams.GET(req("/api/admin/teams"), {} as never);
    expect(teams.status).toBe(200);
    expect(((await teams.json()).teams as { id: string }[]).map((row) => row.id)).toContain(ids.team);

    const inspected = await routes.adminInspect.GET(req("/api/admin/documents/" + ids.paper + "/inspect"), ctx({ id: ids.paper }));
    expect(inspected.status).toBe(200);
    expect((await inspected.json()).document.readOnly).toBe(true);
    expect(await prisma.adminAuditEvent.count({ where: { actorId: ids.appadmin, action: "document.inspected" } })).toBe(1);

    // Admin rights never turn into document edit rights on the ordinary surface.
    expect((await routes.byId.GET(req("/api/documents/" + ids.paper), ctx({ id: ids.paper }))).status).toBe(404);
  });

  it("answers the library with the capability flags the interface draws", async () => {
    await actAs("author");
    const workspaces = await routes.workspaces.GET(req("/api/workspaces"), {} as never);
    const data = await workspaces.json();
    expect(data.workspaces.length).toBeGreaterThanOrEqual(3);
    const lab = data.workspaces.find((row: { id: string }) => row.id === ids.lab);
    expect(lab.capabilities.canRename).toBe(true);
    expect(lab.capabilities.canShare).toBe(true);
    const team = data.workspaces.find((row: { kind: string }) => row.kind === "TEAM");
    expect(team.capabilities.canShare).toBe(false);

    await actAs("reader");
    const rows = (await (await routes.library.GET(req("/api/document"), {} as never)).json()).documents as {
      slug: string;
      canEdit: boolean;
      author: { id: string };
    }[];
    const paper = rows.find((row) => row.slug === "paper");
    expect(paper?.canEdit).toBe(false);
    expect(paper?.author.id).toBe(ids.author);
    expect(rows.find((row) => row.slug === "reader-own-note")?.canEdit).toBe(true);

    const shared = (await (await routes.library.GET(req("/api/document?scope=shared"), {} as never)).json()).documents as { slug: string }[];
    expect(shared.map((row) => row.slug)).toEqual(["paper"]);
  });

  it("rejects an anonymous caller on the new and the legacy surface alike", async () => {
    actor.current = null;
    expect((await routes.library.GET(req("/api/document"), {} as never)).status).toBe(401);
    expect((await routes.byId.GET(req("/api/documents/" + ids.paper), ctx({ id: ids.paper }))).status).toBe(401);
    expect((await routes.bySlug.GET(req("/api/document/paper"), ctx({ slug: "paper" }))).status).toBe(401);
  });

  it("keeps the required workspace foreign key enforced", async () => {
    const row = await prisma.document.findUnique({ where: { id: ids.paper }, select: { workspaceId: true } });
    await expect(prisma.workspace.delete({ where: { id: row.workspaceId } })).rejects.toMatchObject({ code: "P2003" });
  });

  it("signs in a brand new account with a default workspace and no documents", async () => {
    const user = await prisma.user.create({ data: { email: "fresh@workspace-it.test", firstName: "Fresh" }, select: { id: true, email: true } });
    const { workspaceId } = await services.ensureDefaultPersonalWorkspace(prisma, user.id);
    actor.current = { id: user.id, email: user.email };
    const data = await (await routes.library.GET(req("/api/document"), {} as never)).json();
    expect(data.documents).toEqual([]);
    const workspaces = await (await routes.workspaces.GET(req("/api/workspaces"), {} as never)).json();
    expect(workspaces.workspaces.map((row: { id: string }) => row.id)).toContain(workspaceId);

    // Deleting the account takes its collection with it: the owner column and the
    // exactly-one-owner check cannot both survive a SET NULL.
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.workspace.count({ where: { id: workspaceId } })).toBe(0);
  });
});
