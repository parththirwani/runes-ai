import { Search, Grid, List } from 'lucide-react';

type ViewMode = 'grid' | 'list';

interface DashboardSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function DashboardSearch({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange
}: DashboardSearchProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type="text"
          placeholder="Search documents..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
        />
      </div>
      <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-lg p-1">
        <button
          onClick={() => onViewModeChange('grid')}
          className={`p-2 rounded transition-colors cursor-pointer ${
            viewMode === 'grid'
              ? 'bg-white/10 text-white'
              : 'text-gray-500 hover:text-white'
          }`}
        >
          <Grid className="w-4 h-4" />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={`p-2 rounded transition-colors cursor-pointer ${
            viewMode === 'list'
              ? 'bg-white/10 text-white'
              : 'text-gray-500 hover:text-white'
          }`}
        >
          <List className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}