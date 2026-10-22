import { FileText, Trash2, Clock } from 'lucide-react';
import type { DocumentFormatValue } from '@/src/types/compilation';
import FormatBadge from './formatBadge';

interface Document {
  id: string;
  title: string;
  slug: string;
  content?: string | null;
  format?: DocumentFormatValue;
  excerpt?: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentListProps {
  documents: Document[];
  onDocumentClick: (slug: string) => void;
  onDocumentDelete: (doc: Document) => void;
}

export default function DocumentList({
  documents,
  onDocumentClick,
  onDocumentDelete
}: DocumentListProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    if (days < 365) return `${Math.floor(days / 30)}mo ago`;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-2">
      {documents.map((doc) => (
        <div
          key={doc.id}
          role="button"
          tabIndex={0}
          aria-label={`Open ${doc.title}, ${doc.format === 'MARKDOWN' ? 'Markdown' : 'LaTeX'} document`}
          onClick={() => onDocumentClick(doc.slug)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onDocumentClick(doc.slug);
            }
          }}
          className="group bg-white/3 border border-white/10 rounded-xl p-4 hover:bg-white/6 hover:border-white/20 transition-all cursor-pointer flex items-center gap-4 focus-visible:outline-2 focus-visible:outline-emerald-500"
        >
          <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-emerald-400" />
          </div>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 min-w-0">
              <h3 className="font-medium text-white truncate">
                {doc.title}
              </h3>
              <FormatBadge format={doc.format} />
            </div>
            {doc.excerpt && doc.excerpt.length > 0 && (
              <p className="text-xs text-gray-500 truncate mb-1">{doc.excerpt}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatDate(doc.updatedAt)}</span>
              <span className="font-mono text-[10px] text-gray-500">
                .{doc.format === 'MARKDOWN' ? 'md' : 'tex'}
              </span>
            </div>
          </div>

          <button
            onClick={(e) => {
              e.stopPropagation();
              onDocumentDelete(doc);
            }}
            aria-label={`Delete ${doc.title}`}
            className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-2 hover:bg-white/10 rounded-lg transition-all shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-400" />
          </button>
        </div>
      ))}
    </div>
  );
}
