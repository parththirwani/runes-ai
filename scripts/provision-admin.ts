// Controlled provisioning of the app-wide administrator flag.
//
//   bun run scripts/provision-admin.ts --email admin@example.com --grant
//   bun run scripts/provision-admin.ts --email admin@example.com --revoke
//   bun run scripts/provision-admin.ts --list
//
// The flag is never inferred from an email domain, a client claim, or a request body (see
// docs/workspaces-teams-access-plan.md, Admin boundaries), so this operator script is the
// supported way to change it. Run it from a deployment shell, not from a request handler.

import { prisma } from "../src/lib/db";
import { normalizeEmail } from "../src/lib/email";

function flag(name: string): string | null {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main() {
  const email = flag("email");
  const grant = process.argv.includes("--grant");
  const revoke = process.argv.includes("--revoke");
  const list = process.argv.includes("--list");

  if (list) {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { email: true, firstName: true, lastName: true },
      orderBy: { email: "asc" },
    });
    console.log("[provision-admin] admins=" + admins.length);
    for (const admin of admins) console.log("[provision-admin] " + admin.email);
    return;
  }

  if (!email) {
    console.error("usage: provision-admin.ts --email <address> [--grant|--revoke] | --list");
    process.exitCode = 2;
    return;
  }

  const normalized = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalized }, select: { id: true, email: true } });
  if (!user) {
    // Never create an account here: an administrator must have signed in at least once.
    console.error("[provision-admin] no user with that address; the account has to sign in first");
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin: grant && !revoke } });
  console.log("[provision-admin] " + (grant && !revoke ? "granted" : "revoked") + " app admin for " + user.email);
}

main().catch((error) => {
  console.error("[provision-admin] FAILED", error instanceof Error ? error.constructor.name : error);
  process.exitCode = 1;
});
