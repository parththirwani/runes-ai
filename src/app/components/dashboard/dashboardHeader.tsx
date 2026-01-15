import { Zap, Plus } from 'lucide-react';
import Button from '../ui/Button';

interface DashboardHeaderProps {
  onCreateDocument: () => void;
}

export default function DashboardHeader({ onCreateDocument }: DashboardHeaderProps) {
  return (
    <header className="border-b border-white/5 backdrop-blur-xl bg-black/40 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity">
            <Zap className="w-6 h-6 text-emerald-400" />
            <h1 className="text-lg font-semibold">
              Runes<span className="text-emerald-400">AI</span>
            </h1>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={onCreateDocument}
            className="cursor-pointer"
          >
            New
          </Button>
        </div>
      </div>
    </header>
  );
}