import { FileText, Clock } from 'lucide-react';
import type { DocumentFormatValue } from '@/src/types/compilation';
import DocumentActions from './documentActions';
import FormatBadge from './formatBadge';
import DocumentStatusBadge from './documentStatusBadge';

interface Document {
  id: string;
  title: string;
  slug: string;
  content?: string | null;
  format?: DocumentFormatValue;
  isFavorite: boolean;
  excerpt?: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentGridProps {
  documents: Document[];
  onDocumentClick: (slug: string) => void;
  onDocumentDelete: (doc: Document) => Promise<void>;
  onFavoriteChange: (doc: Document) => void;
}

export default function DocumentGrid({
  documents,
  onDocumentClick,
  onDocumentDelete,
  onFavoriteChange,
}: DocumentGridProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {documents.map((doc) => (
        <div
          key={doc.id}
          role="button"
          tabIndex={0}
          aria-label={`Open ${doc.title}, ${doc.format === 'MARKDOWN' ? 'Markdown' : 'LaTeX'} document`}
          onClick={() => onDocumentClick(doc.slug)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onDocumentClick(doc.slug);
            }
          }}
          className="group relative cursor-pointer rounded-xl border border-border bg-surface p-5 transition-colors hover:border-line-strong hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 bg-action-soft rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-action" />
            </div>
            <div className="flex items-center gap-1">
              <DocumentStatusBadge />
              <FormatBadge format={doc.format} />
              <DocumentActions document={doc} onDelete={() => onDocumentDelete(doc)} onFavoriteChange={() => onFavoriteChange(doc)} />
            </div>
          </div>
          
          <h3 className="font-medium text-foreground mb-2 truncate text-base">
            {doc.title}
          </h3>
          
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4 leading-relaxed">
            {doc.excerpt && doc.excerpt.length > 0 ? doc.excerpt : 'No preview available.'}
          </p>
          
          <div className="flex items-center gap-2 text-xs text-meta">
            <Clock className="w-3.5 h-3.5" />
            <span>Updated {formatDate(doc.updatedAt)}</span>
            <span className="ml-auto font-mono text-[10px] text-meta">
              .{doc.format === 'MARKDOWN' ? 'md' : 'tex'}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
