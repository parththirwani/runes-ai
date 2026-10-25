#!/usr/bin/env node
// Multi-account UI surface smoke against a running development server.
//
//   node scripts/ui-surface-smoke.mjs --base http://127.0.0.1:3000
//
// This is the browser-free counterpart of scripts/browser-smoke.py: it calls exactly the
// endpoints the interface calls, as five different accounts, against the real database and the
// real server-rendered pages, and asserts what each account is allowed to see and do.
//
// Redis and the compile worker are deliberately out of scope, because neither runs on a laptop
// by default and the rate limiter waits on Redis forever. That means no successful compile is
// requested here; the checks cover who may *dispatch* one and who may read the result.
//
// A run creates its own accounts (the address ends in .test, which dev-login is allowed to
// create), its own workspace, and its own document, and removes the document again at the end.

import crypto from "node:crypto";
import pg from "pg";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const BASE = flag("--base", process.env.SMOKE_BASE || "http://127.0.0.1:3000");
const RUN = Date.now().toString(36).slice(-6);
const emailOf = (role) => `${role}-${RUN}@ui-smoke.test`;
const keep = has("--keep");

const roles = { author: emailOf("author"), reader: emailOf("reader"), stranger: emailOf("stranger"), admin: emailOf("admin") };

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || detail === undefined ? "" : `   got: ${detail}`}`);
}
function equal(label, actual, expected) {
  check(label, actual === expected, JSON.stringify(actual));
  return actual;
}

function jarFor() {
  const store = new Map();
  return {
    header: () => [...store.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    absorb(response) {
      const lines = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
      for (const line of lines) {
        const pair = line.split(";")[0];
        const eq = pair.indexOf("=");
        if (eq > 0) store.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
    },
  };
}

async function send(jar, method, path, body) {
  const init = { method, redirect: "manual", headers: {} };
  if (jar) {
    const cookie = jar.header();
    if (cookie) init.headers.cookie = cookie;
  }
  if (body !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(BASE + path, init);
  if (jar) jar.absorb(response);
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("json") ? await response.json().catch(() => null) : null;
  return { status: response.status, location: response.headers.get("location"), data: payload, text: payload ? "" : await response.text() };
}

async function signIn(email) {
  const jar = jarFor();
  const response = await send(jar, "POST", "/api/dev-login", { email });
  if (response.status !== 200) throw new Error(`dev-login for ${email} returned ${response.status}`);
  return { jar, email, user: response.data.user };
}

const tokenOf = (invitation) => (invitation?.delivery?.path || "").split("/").filter(Boolean).pop() || "";
const findRow = (rows, slug) => (rows || []).find((row) => row.slug === slug);

async function main() {
  console.log(`ui-surface-smoke against ${BASE} as ${JSON.stringify(roles)}`);
  const probe = await send(null, "GET", "/api/document");
  if (probe.status === 404) throw new Error(`${BASE} is not a running dev server`);

  const anon = await send(null, "GET", "/api/document");
  equal("anonymous library request is refused", anon.status, 401);

  const author = await signIn(roles.author);
  const reader = await signIn(roles.reader);
  const stranger = await signIn(roles.stranger);
  check("three accounts signed in through dev-login", Boolean(author.user.id && reader.user.id && stranger.user.id));

  const workspace = await send(author.jar, "POST", "/api/workspaces", { name: `Smoke Lab ${RUN}` });
  equal("author creates a personal workspace", workspace.status, 201);
  const workspaceId = workspace.data?.workspace?.id;

  const created = await send(author.jar, "POST", "/api/document", { title: `Smoke ${RUN}`, format: "MARKDOWN", workspaceId });
  equal("author creates a document inside it", created.status, 201);
  const doc = created.data || {};
  equal("the document reports the workspace it was created in", doc.workspaceId, workspaceId);

  const listed = await send(author.jar, "GET", "/api/document");
  const ownRow = findRow(listed.data?.documents, doc.slug);
  check("the library lists the new document as editable", ownRow?.canEdit === true, JSON.stringify(ownRow));
  check("the library names the author so the table can show it", ownRow?.author?.id === author.user.id, JSON.stringify(ownRow?.author));
  check("the library never ships the document body", ownRow && !("content" in ownRow), Object.keys(ownRow || {}).join(","));

  const workspaces = await send(author.jar, "GET", "/api/workspaces");
  const mine = (workspaces.data?.workspaces || []).find((row) => row.id === workspaceId);
  check("the workspace switcher can rename and share it", mine?.capabilities?.canRename === true && mine?.capabilities?.canShare === true, JSON.stringify(mine));

  const invited = await send(author.jar, "POST", `/api/documents/${doc.id}/shares`, { email: roles.reader });
  equal("the author invites the reader by email", invited.status, 201);
  const token = tokenOf(invited.data?.invitation);
  check("without an email webhook the invite comes back as a dev link", invited.data?.invitation?.delivery?.channel === "development-link" && token.length > 10, JSON.stringify(invited.data?.invitation?.delivery));

  const previewWrong = await send(stranger.jar, "GET", `/api/invitations/${token}`);
  equal("the link is useless to anybody but the named address", previewWrong.data?.preview?.state, "wrong-email");
  const previewRight = await send(reader.jar, "GET", `/api/invitations/${token}`);
  equal("the named address sees an open invitation", previewRight.data?.preview?.state, "valid");

  const beforeAccept = await send(reader.jar, "GET", `/api/documents/${doc.id}`);
  equal("an open invitation is not access yet", beforeAccept.status, 404);

  const accepted = await send(reader.jar, "POST", `/api/invitations/${token}`);
  equal("the named address accepts", accepted.status, 200);
  equal("accepting twice changes nothing", (await send(reader.jar, "POST", `/api/invitations/${token}`)).data?.invitation?.alreadyAccepted, true);

  const shared = findRow((await send(reader.jar, "GET", "/api/document?scope=shared")).data?.documents, doc.slug);
  check("the shared document appears under the shared scope only", Boolean(shared) && !findRow((await send(reader.jar, "GET", "/api/document?scope=mine")).data?.documents, doc.slug), JSON.stringify(shared));
  check("the reader is told the document is view only", shared?.canEdit === false, JSON.stringify(shared));

  const readerView = await send(reader.jar, "GET", `/api/documents/${doc.id}`);
  equal("the reader may open the document", readerView.status, 200);
  check("the payload carries the flags the editor draws", readerView.data?.capabilities?.canEdit === false && readerView.data?.capabilities?.canShare === false, JSON.stringify(readerView.data?.capabilities));

  // The editor renders its viewer state from the legacy payload, which is also where the
  // author's name comes from: never from a string the client typed.
  const editorSource = await send(reader.jar, "GET", `/api/document/${doc.slug}`);
  equal("the editor source answers the reader", editorSource.status, 200);
  check("the editor can name the author", editorSource.data?.document?.author?.email === roles.author, JSON.stringify(editorSource.data?.document?.author));
  check("the editor source says the caller may not edit", editorSource.data?.document?.access?.canEdit === false, JSON.stringify(editorSource.data?.document?.access));

  const readBack = await send(reader.jar, "GET", `/api/document/${doc.slug}/file?path=main.md`);
  equal("the reader may read the source file", readBack.status, 200);

  const denied = [
    ["save", "PUT", `/api/document/${doc.slug}`, { content: "# rewritten\n" }],
    ["rename", "PATCH", `/api/document/${doc.slug}`, { title: "Mine now" }],
    ["favorite", "PATCH", `/api/document/${doc.slug}`, { isFavorite: true }],
    ["main file", "POST", `/api/document/${doc.slug}/main`, { path: "main.md" }],
    ["delete", "DELETE", `/api/document/${doc.slug}`],
    ["share onward", "POST", `/api/documents/${doc.id}/shares`, { email: emailOf("another") }],
    ["move", "POST", `/api/documents/${doc.id}/move`, { workspaceId: workspaceId }],
  ];
  for (const [label, method, path, body] of denied) {
    equal(`the reader cannot ${label}`, (await send(reader.jar, method, path, body)).status, 404);
  }

  equal("an unrelated account cannot open the document", (await send(stranger.jar, "GET", `/api/documents/${doc.id}`)).status, 404);
  check("the unrelated account library stays empty", !(await send(stranger.jar, "GET", "/api/document")).data?.documents?.length);
  equal("the admin console is not for a plain account", (await send(author.jar, "GET", "/admin")).status, 307);

  const shares = await send(author.jar, "GET", `/api/documents/${doc.id}/shares`);
  const grant = (shares.data?.shares || []).find((row) => row.email === roles.reader && row.status === "ACCEPTED");
  check("the share list shows the accepted reader", Boolean(grant), JSON.stringify(shares.data?.shares));

  // The team half of the interface needs a database flag no invitation can set.
  let admin = null;
  // The Prisma connection string carries a schema query parameter that libpq does not know.
  const databaseUrl = (process.env.DATABASE_URL || "").split("?")[0];
  if (databaseUrl) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`INSERT INTO "users" ("id", "email", "firstName", "lastName", "isAdmin", "updatedAt") VALUES ($1, $2, 'Smoke', 'Admin', true, now()) ON CONFLICT ("email") DO UPDATE SET "isAdmin" = true`, [crypto.randomUUID(), roles.admin]);
    await client.end();
    admin = await signIn(roles.admin);
  } else {
    check("DATABASE_URL is set so the admin half can be checked", false, "unset");
  }

  if (admin) {
    equal("the admin console renders for an app admin", (await send(admin.jar, "GET", "/admin")).status, 200);
    const team = await send(admin.jar, "POST", "/api/teams", { name: `Smoke Team ${RUN}` });
    equal("the admin creates a team", team.status, 201);
    const teamId = team.data?.team?.teamId;
    const teamWorkspaceId = team.data?.team?.workspaceId;

    const teamInvite = await send(admin.jar, "POST", `/api/teams/${teamId}/members`, { email: roles.author });
    equal("the admin invites the author into it", teamInvite.status, 201);
    equal("the author accepts the team invitation", (await send(author.jar, "POST", `/api/invitations/${tokenOf(teamInvite.data?.invitation)}`)).status, 200);

    const teamRow = (await send(author.jar, "GET", "/api/workspaces")).data?.workspaces?.find((row) => row.id === teamWorkspaceId);
    check("the team workspace shows up read shared for a member", teamRow?.kind === "TEAM" && teamRow?.capabilities?.canShare === false, JSON.stringify(teamRow));

    const previewMove = await send(author.jar, "POST", `/api/documents/${doc.id}/move?preview=1`, { workspaceId: teamWorkspaceId });
    equal("the move preview says the team will gain view access", previewMove.data?.preview?.grantsTeamAccess, true);
    equal("the author moves the document into the team workspace", (await send(author.jar, "POST", `/api/documents/${doc.id}/move`, { workspaceId: teamWorkspaceId })).status, 200);
    equal("a team member can read it afterwards", (await send(admin.jar, "GET", `/api/documents/${doc.id}`)).status, 200);

    const inspected = await send(admin.jar, "GET", `/api/admin/documents/${doc.id}/inspect`);
    equal("the admin inspects it through the audited endpoint", inspected.status, 200);
    equal("inspection is read only", inspected.data?.document?.readOnly, true);
    const audit = await send(admin.jar, "GET", "/api/admin/audit");
    check("the inspection is in the audit history", (audit.data?.events || []).some((row) => row.action === "document.inspected"), JSON.stringify((audit.data?.events || []).slice(0, 3)));
    equal("admin rights are not document rights on the ordinary surface", (await send(admin.jar, "PUT", `/api/document/${doc.slug}`, { content: "# admin edit\n" })).status, 404);
  }

  equal("the author revokes the reader", (await send(author.jar, "DELETE", `/api/documents/${doc.id}/shares`, { kind: "document-grant", id: grant?.id })).status, 200);
  equal("the reader loses the document on the next request", (await send(reader.jar, "GET", `/api/documents/${doc.id}`)).status, 404);
  equal("and loses the cached preview with it", (await send(reader.jar, "GET", `/api/documents/${doc.id}/pdf`)).status, 404);

  if (!keep) {
    equal("the author deletes the document again", (await send(author.jar, "DELETE", `/api/document/${doc.slug}`)).status, 200);
  }
}

main()
  .then(() => {
    const failed = results.filter((row) => !row.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  })
  .catch((error) => {
    console.error(`\nui-surface-smoke aborted: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
