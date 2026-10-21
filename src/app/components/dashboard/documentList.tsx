import Link from "next/link";
import { EMPTY_SUMMARY_LABEL } from "@/src/lib/latex-summary";
import { describeUpdate, formatAbsoluteDate, formatRelativeDate } from "@/src/lib/date-format";
import { DOCUMENT_PATH } from "@/src/lib/paths";
import type { DashboardDocument } from "@/src/types/dashboard";
import DocumentActions from "./documentActions";

interface DocumentListProps {
  documents: DashboardDocument[];
  onDocumentClick: (slug: string) => void;
  onDocumentDelete: (document: DashboardDocument) => void;
}

export default function DocumentList({
  documents,
  onDocumentClick,
  onDocumentDelete,
}: DocumentListProps) {
  return (
    <ul className="divide-y divide-border-subtle border-y border-border-subtle">
      {documents.map((document) => (
        <li key={document.id}>
          <div
            data-document-card
            onClick={() => onDocumentClick(document.slug)}
            className="flex cursor-pointer items-center gap-4 px-1 py-4 transition-colors hover:bg-surface-raised/40"
          >
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-sm font-medium text-foreground">
                <Link href={DOCUMENT_PATH(document.slug)} className="focus-visible:outline-2">
                  {document.title}
                </Link>
              </h3>
              <p
                className={`mt-1 truncate text-sm ${
                  document.summary ? "text-muted-foreground" : "text-meta italic"
                }`}
              >
                {document.summary ?? EMPTY_SUMMARY_LABEL}
              </p>
            </div>

            <time
              dateTime={document.updatedAt}
              title={formatAbsoluteDate(document.updatedAt)}
              aria-label={describeUpdate(document.updatedAt)}
              className="hidden shrink-0 font-mono text-xs text-meta sm:block"
            >
              Updated {formatRelativeDate(document.updatedAt)}
            </time>

            <DocumentActions document={document} onDelete={onDocumentDelete} />
          </div>
        </li>
      ))}
    </ul>
  );
}
