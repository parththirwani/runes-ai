import { Menu, FileText, Save, Play, Sparkles, Settings, Zap, Download, Clock, Users } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import ViewModeToggle from './ViewModeToggle';

type ViewMode = 'editor' | 'split' | 'preview';

interface TopNavBarProps {
  documentTitle: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onMenuToggle: () => void;
  onSave: () => void;
  onCompile: () => void;
  onAIToggle: () => void;
  isSaving?: boolean;
  isCompiling?: boolean;
}

export default function TopNavBar({
  documentTitle,
  viewMode,
  onViewModeChange,
  onMenuToggle,
  onSave,
  onCompile,
  onAIToggle,
  isSaving = false,
  isCompiling = false
}: TopNavBarProps) {
  return (
    <div className="h-14 bg-[#2d2d2d] border-b border-[#3e3e3e] flex items-center justify-between px-4 relative z-30">
      {/* Left Section */}
      <div className="flex items-center gap-4">
        <IconButton
          icon={<Menu className="w-5 h-5" />}
          onClick={onMenuToggle}
          tooltip="Toggle file tree"
        />
        
        <div className="flex items-center gap-2">
          <Zap className="w-6 h-6 text-emerald-500" />
          <span className="font-bold text-lg text-white">
            Runes<span className="text-emerald-500">AI</span>
          </span>
        </div>
        
        <div className="h-6 w-px bg-[#3e3e3e]" />
        
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FileText className="w-4 h-4" />
          <span className="max-w-50 truncate">{documentTitle}</span>
          <button className="text-gray-500 hover:text-gray-300 transition-colors">
            <Clock className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2">
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
        
        <div className="h-6 w-px bg-[#3e3e3e]" />

        <Button
          variant="ghost"
          size="sm"
          icon={<Users className="w-4 h-4" />}
          className="text-gray-300 hover:text-white"
        >
          Share
        </Button>

        <Button
          variant="secondary"
          size="sm"
          icon={<Save className="w-4 h-4" />}
          onClick={onSave}
          loading={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save'}
        </Button>

        <Button
          variant="primary"
          size="sm"
          icon={<Play className="w-4 h-4" />}
          onClick={onCompile}
          loading={isCompiling}
        >
          {isCompiling ? 'Compiling...' : 'Compile'}
        </Button>

        <Button
          variant="ai"
          size="sm"
          icon={<Sparkles className="w-5 h-5" />}
          onClick={onAIToggle}
        />

        <IconButton
          icon={<Settings className="w-5 h-5" />}
          tooltip="Settings"
        />
      </div>
    </div>
  );
}