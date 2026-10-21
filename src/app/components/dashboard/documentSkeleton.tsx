import type { DocumentViewMode } from "@/src/types/dashboard";

const CARDS = [0, 1, 2, 3, 4, 5];

/** Load placeholder that matches the shape of the real cards and rows. */
export default function DocumentSkeleton({ viewMode }: { viewMode: DocumentViewMode }) {
  if (viewMode === "list") {
    return (
      <ul className="divide-y divide-border-subtle border-y border-border-subtle" aria-hidden="true">
        {CARDS.slice(0, 4).map((row) => (
          <li key={row} className="flex items-center gap-4 px-1 py-5">
            <div className="min-w-0 flex-1 space-y-2">
              <span className="skeleton block h-3.5 w-40" />
              <span className="skeleton block h-3 w-72 max-w-full" />
            </div>
            <span className="skeleton hidden h-3 w-24 sm:block" />
            <span className="skeleton size-9" />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {CARDS.map((card) => (
        <li key={card} className="flex h-full flex-col rounded-lg border border-border bg-surface p-4">
          <span className="skeleton block h-3.5 w-32" />
          <span className="skeleton mt-3 block h-3 w-full" />
          <span className="skeleton mt-2 block h-3 w-4/5" />
          <span className="skeleton mt-6 block h-3 w-28" />
        </li>
      ))}
    </ul>
  );
}
