// Grants or revokes the app-wide admin flag for one account.
//
//   bun run scripts/provision-admin.ts --email name@example.test
//   bun run scripts/provision-admin.ts --email name@example.test --revoke
//
// This is the only supported way to change the flag. Nothing in the app infers admin status from an
// email domain, a name, or a client claim, so an account that has never been provisioned here cannot
// reach a single admin route. The change is written to the same audit trail the console reads.

import { prisma } from '../src/lib/db';
import { recordAuditEvent } from '../src/lib/audit';

function argument(name: string): string | null {
  const index = process.argv.indexOf('--' + name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

async function main(): Promise<number> {
  const email = (argument('email') ?? process.env.ADMIN_EMAIL ?? '').trim();
  if (email.length === 0) {
    console.error('Usage: bun run scripts/provision-admin.ts --email name@example.test [--revoke]');
    return 2;
  }
  const revoke = process.argv.includes('--revoke');

  const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  if (!user) {
    console.error('No account with that email. The person has to sign in once before they can be provisioned.');
    return 1;
  }

  const updated = await prisma.user.update({ where: { id: user.id }, data: { isAdmin: !revoke } });
  await recordAuditEvent({
    actorUserId: user.id,
    action: 'admin.provision',
    targetUserId: updated.id,
    metadata: { isAdmin: updated.isAdmin, via: 'script' },
  });

  console.log(JSON.stringify({ userId: updated.id, email: updated.email, isAdmin: updated.isAdmin }));
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    if (code !== 0) process.exit(code);
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
