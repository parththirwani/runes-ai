import { FileSearch, FilePlus2, Inbox } from "lucide-react";
import { Button } from "../ui/button";

interface EmptyStateProps {
  searchQuery?: string;
  onCreateDocument?: () => void;
  onClearSearch?: () => void;
}

export default function EmptyState({ searchQuery, onCreateDocument, onClearSearch }: EmptyStateProps) {
  if (searchQuery) {
    return (
      <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <FileSearch className="mx-auto h-6 w-6 text-meta" aria-hidden="true" />
        <h3 className="mt-4 text-base font-medium text-foreground">No documents match that search</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Nothing titled <span className="text-foreground">“{searchQuery}”</span>. Titles are matched
          exactly as you type, so try fewer characters.
        </p>
        {onClearSearch && (
          <Button variant="outline" size="sm" className="mt-6" onClick={onClearSearch}>
            Clear search
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <Inbox className="mx-auto h-6 w-6 text-meta" aria-hidden="true" />
      <h3 className="mt-4 text-base font-medium text-foreground">Your workspace is empty</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        New documents start with a minimal LaTeX preamble, a title and one
        section, so you can get to writing straight away.
      </p>
      {onCreateDocument && (
        <Button className="mt-6" onClick={onCreateDocument}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Create your first document
        </Button>
      )}
    </div>
  );
}
