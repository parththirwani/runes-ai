import DashboardPage from "../components/dashboard/dashboardPage";
import type { CreateFormat } from "@/src/lib/paths";

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const { create } = await searchParams;
  const initialCreateFormat: CreateFormat | null =
    create === "MARKDOWN" || create === "LATEX" ? create : null;

  return <DashboardPage initialCreateFormat={initialCreateFormat} />;
}
