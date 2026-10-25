// Idempotent workspace-ownership backfill for document collections.
//
//   bun run scripts/migrate-workspace-ownership.ts --apply
//   bun run scripts/migrate-workspace-ownership.ts --verify
//
// Runs the same statements as prisma/migrations/20261025190100_workspace_backfill, so it
// can be re-run after a deploy or rehearsed against a staging copy. A second --apply run
// reports zero changed rows. The SQL and the verification live in
// src/lib/workspace-ownership.ts, which is what the tests exercise.

import { prisma } from "../src/lib/db";
import { applyOwnershipBackfill, verifyOwnership, type RawClient } from "../src/lib/workspace-ownership";

type Mode = "apply" | "verify";

function mode(): Mode {
  const argument = process.argv.slice(2).find((value) => value.startsWith("--"));
  return argument === "--verify" ? "verify" : "apply";
}

const client = prisma as unknown as RawClient;

function reportLines(prefix: string, report: { counts: Record<string, number>; problems: string[] }): string[] {
  const counts = Object.entries(report.counts).map(([key, value]) => key + "=" + value).join(" ");
  return [prefix + " " + counts, prefix + " problems=" + (report.problems.length === 0 ? "none" : report.problems.join(" | "))];
}

async function main() {
  const selected = mode();
  console.log("[workspace-ownership] mode=" + selected);

  if (selected === "apply") {
    const report = await applyOwnershipBackfill(client);
    console.log(
      "[workspace-ownership] createdDefaultWorkspaces=" + report.createdDefaultWorkspaces +
        " assignedDocuments=" + report.assignedDocuments,
    );
    for (const line of reportLines("[workspace-ownership]", report)) console.log(line);
    if (report.problems.length > 0) process.exitCode = 1;
    return;
  }

  const report = await verifyOwnership(client);
  for (const line of reportLines("[workspace-ownership]", report)) console.log(line);
  if (report.problems.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[workspace-ownership] FAILED", error instanceof Error ? error.message : error);
  process.exit(1);
});
