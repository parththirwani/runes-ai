// Shape returned by GET /api/document. The list never receives raw LaTeX: the
// route converts the source into `summary` (null when there is no prose).
export interface DashboardDocument {
  id: string;
  title: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
}

export type DocumentViewMode = "grid" | "list";
