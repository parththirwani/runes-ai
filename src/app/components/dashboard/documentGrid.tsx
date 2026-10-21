import Link from "next/link";
import { EMPTY_SUMMARY_LABEL } from "@/src/lib/latex-summary";
import { describeUpdate, formatAbsoluteDate, formatRelativeDate } from "@/src/lib/date-format";
import { DOCUMENT_PATH } from "@/src/lib/paths";
import type { DashboardDocument } from "@/src/types/dashboard";
import DocumentActions from "./documentActions";

interface DocumentGridProps {
  documents: DashboardDocument[];
  onDocumentClick: (slug: string) => void;
  onDocumentDelete: (document: DashboardDocument) => void;
}

export default function DocumentGrid({
  documents,
  onDocumentClick,
  onDocumentDelete,
}: DocumentGridProps) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {documents.map((document) => (
        <li key={document.id}>
          <article
            data-document-card
            onClick={() => onDocumentClick(document.slug)}
            className="flex h-full cursor-pointer flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-hover hover:bg-surface-raised/60"
          >
            <h3 className="text-sm font-medium text-foreground">
              <Link
                href={DOCUMENT_PATH(document.slug)}
                className="line-clamp-2 focus-visible:outline-2"
              >
                {document.title}
              </Link>
            </h3>

            <p
              className={`mt-2 line-clamp-3 flex-1 text-sm leading-relaxed ${
                document.summary ? "text-muted-foreground" : "text-meta italic"
              }`}
            >
              {document.summary ?? EMPTY_SUMMARY_LABEL}
            </p>

            <div className="relative z-10 mt-4 flex items-center justify-between gap-2 border-t border-border-subtle pt-3">
              <time
                dateTime={document.updatedAt}
                title={formatAbsoluteDate(document.updatedAt)}
                aria-label={describeUpdate(document.updatedAt)}
                className="font-mono text-xs text-meta"
              >
                Updated {formatRelativeDate(document.updatedAt)}
              </time>
              <DocumentActions document={document} onDelete={onDocumentDelete} />
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
