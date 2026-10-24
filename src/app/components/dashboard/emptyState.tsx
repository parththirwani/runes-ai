import { FileSearch, FileText, Plus, X } from 'lucide-react';
import Button from '../design/Button';

interface EmptyStateProps {
  searchQuery?: string;
  onCreateDocument?: () => void;
  onClearFilters?: () => void;
  /** True when documents exist but search/filter hides them all. */
  filtered?: boolean;
}

export default function EmptyState({
  searchQuery,
  onCreateDocument,
  onClearFilters,
  filtered,
}: EmptyStateProps) {
  if (searchQuery || filtered) {
    return (
      <div className="rounded-xl border border-border bg-surface px-6 py-20 text-center">
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-surface-raised">
          <FileSearch className="size-6 text-meta" aria-hidden="true" />
        </div>
        <h3 className="font-serif text-lg font-semibold text-foreground">No matching documents</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          {searchQuery
            ? `No documents match “${searchQuery}”. Try another search or clear the filters.`
            : 'No documents match the selected format filter.'}
        </p>
        {onClearFilters && (
          <Button
            variant="secondary"
            icon={<X className="size-4" />}
            onClick={onClearFilters}
            className="mt-6"
          >
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface px-6 py-24 text-center">
      <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-surface-raised">
        <FileText className="size-8 text-meta" aria-hidden="true" />
      </div>
      <h3 className="font-serif text-[22px] font-semibold tracking-tight text-foreground">
        No documents yet
      </h3>
      <p className="mx-auto mb-8 max-w-sm text-sm text-muted-foreground">
        Create your first Markdown or LaTeX document to get started
      </p>
      <Button
        variant="primary"
        icon={<Plus className="size-4" />}
        onClick={onCreateDocument}
      >
        Create document
      </Button>
    </div>
  );
}
