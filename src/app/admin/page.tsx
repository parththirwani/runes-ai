// App-admin console. The session flag only hides navigation, so the page re-reads the database
// flag before rendering anything: a stale or hand-edited token gets the same answer as any other
// unauthorised page. The admin APIs repeat this check on every call.

import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { isAppAdmin } from "@/src/lib/access";
import AdminDashboard from "@/src/app/components/admin/adminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) redirect("/signin?callbackUrl=%2Fadmin");
  if (!(await isAppAdmin(prisma, userId))) redirect("/document");

  return <AdminDashboard />;
}
