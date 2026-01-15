import { FileText, Trash2, Clock } from 'lucide-react';

interface Document {
  id: string;
  title: string;
  slug: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface DocumentGridProps {
  documents: Document[];
  onDocumentClick: (slug: string) => void;
  onDocumentDelete: (doc: Document) => void;
}

export default function DocumentGrid({
  documents,
  onDocumentClick,
  onDocumentDelete
}: DocumentGridProps) {
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
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {documents.map((doc) => (
        <div
          key={doc.id}
          onClick={() => onDocumentClick(doc.slug)}
          className="group bg-white/3 border border-white/10 rounded-xl p-5 hover:bg-white/6 hover:border-white/20 transition-all cursor-pointer relative"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-10 h-10 bg-emerald-500/10 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-emerald-400" />
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDocumentDelete(doc);
              }}
              className="opacity-0 group-hover:opacity-100 p-2 hover:bg-white/10 rounded-lg transition-all cursor-pointer"
            >
              <Trash2 className="w-4 h-4 text-gray-500 hover:text-red-400" />
            </button>
          </div>
          
          <h3 className="font-medium text-white mb-2 truncate text-base">
            {doc.title}
          </h3>
          
          <p className="text-sm text-gray-500 line-clamp-2 mb-4 leading-relaxed">
            {doc.content.replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, '').substring(0, 80)}...
          </p>
          
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatDate(doc.updatedAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}