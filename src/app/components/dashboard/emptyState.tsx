import { FileText, Plus } from 'lucide-react';
import Button from '../design/Button';

interface EmptyStateProps {
  searchQuery?: string;
  onCreateDocument?: () => void;
}

export default function EmptyState({ searchQuery, onCreateDocument }: EmptyStateProps) {
  if (searchQuery) {
    return (
      <div className="text-center py-24">
        <p className="text-gray-500 text-sm">No documents found matching "{searchQuery}"</p>
      </div>
    );
  }

  return (
    <div className="text-center py-24">
      <div className="w-16 h-16 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-6">
        <FileText className="w-8 h-8 text-gray-600" />
      </div>
      <h3 className="text-xl font-semibold mb-2">No documents yet</h3>
      <p className="text-gray-500 mb-8 text-sm max-w-sm mx-auto">
        Create your first LaTeX document to get started
      </p>
      <Button
        variant="primary"
        icon={<Plus className="w-4 h-4" />}
        onClick={onCreateDocument}
        className="cursor-pointer"
      >
        Create Document
      </Button>
    </div>
  );
}