import { Menu, FileText, Save, Play, Sparkles, Settings, Zap, Download, Clock, Users, Edit2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
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
  onTitleEdit?: () => void;
  isSaving?: boolean;
  isCompiling?: boolean;
  hasUnsavedChanges?: boolean;
}

export default function TopNavBar({
  documentTitle,
  viewMode,
  onViewModeChange,
  onMenuToggle,
  onSave,
  onCompile,
  onAIToggle,
  onTitleEdit,
  isSaving = false,
  isCompiling = false,
  hasUnsavedChanges = false
}: TopNavBarProps) {
  const router = useRouter();

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
          <button
            onClick={() => router.push('/document')}
            className="font-bold text-lg text-white hover:text-emerald-400 transition-colors"
          >
            Runes<span className="text-emerald-500">AI</span>
          </button>
        </div>
        
        <div className="h-6 w-px bg-[#3e3e3e]" />
        
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FileText className="w-4 h-4" />
          <button
            onClick={onTitleEdit}
            className="max-w-50 truncate hover:text-gray-200 transition-colors flex items-center gap-1 group"
            title="Click to edit title"
          >
            <span>{documentTitle}</span>
            <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          {hasUnsavedChanges && (
            <span className="w-2 h-2 bg-yellow-500 rounded-full" title="Unsaved changes" />
          )}
        </div>
      </div>

      {/* Right Section */}
      <div className="flex items-center gap-2">
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} />
        
        <div className="h-6 w-px bg-[#3e3e3e]" />

        <Button
          variant="secondary"
          size="sm"
          icon={<Save className="w-4 h-4" />}
          onClick={onSave}
          loading={isSaving}
        >
          {isSaving ? 'Saving...' : hasUnsavedChanges ? 'Save' : 'Saved'}
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