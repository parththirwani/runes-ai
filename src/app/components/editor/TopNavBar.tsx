import { Menu, FileText, Save, Play, Sparkles, Edit2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Button from '../design/Button';
import IconButton from '../design/IconButton';
import ViewModeToggle from './ViewModeToggle';

type ViewMode = 'editor' | 'split' | 'preview';

interface TopNavBarProps {
  documentTitle: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onMenuToggle: () => void;
  onSave: () => void;
  onCompile: () => void;
  onSettingsToggle?: () => void;
  onTitleEdit?: () => void;
  isSaving?: boolean;
  isCompiling?: boolean;
  hasUnsavedChanges?: boolean;
  compilationStatus?: string;
}

export default function TopNavBar({
  documentTitle,
  viewMode,
  onViewModeChange,
  onMenuToggle,
  onSave,
  onCompile,
  onSettingsToggle,
  onTitleEdit,
  isSaving = false,
  isCompiling = false,
  hasUnsavedChanges = false,
  compilationStatus = ''
}: TopNavBarProps) {
  const router = useRouter();

  return (
    <div className="min-h-14 bg-[#2d2d2d] border-b border-[#3e3e3e] flex flex-wrap items-center justify-between gap-2 px-4 py-2 relative z-30 shrink-0">
      {/* Left Section */}
      <div className="flex min-w-0 flex-wrap items-center gap-4">
        <IconButton
          icon={<Menu className="w-5 h-5" />}
          onClick={onMenuToggle}
          tooltip="Toggle file tree"
          className="cursor-pointer"
        />
        
        <div className="hidden sm:flex items-center gap-2">
          <button
            onClick={() => router.push('/document')}
            className="flex h-8 w-48 items-center overflow-hidden hover:opacity-80 transition-opacity cursor-pointer"
          >
            <Image
              src="/logo.png"
              alt="RunesAI Logo"
              width={200}
              height={32}
              className="h-8 w-full object-contain"
            />
          </button>
        </div>
        
        <div className="h-6 w-px bg-[#3e3e3e]" />
        
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <FileText className="w-4 h-4" />
          <button
            onClick={onTitleEdit}
            className="max-w-50 truncate hover:text-gray-200 transition-colors flex items-center gap-1 group cursor-pointer"
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
      <div className="flex max-w-full flex-wrap items-center gap-2">
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
          disabled={isCompiling}
        >
          {isCompiling ? compilationStatus || 'Compiling...' : 'Compile'}
        </Button>

        <IconButton
          icon={<Sparkles className="w-5 h-5" />}
          tooltip="AI workspace"
          onClick={onSettingsToggle}
          className="cursor-pointer"
        />
      </div>
    </div>
  );
}
