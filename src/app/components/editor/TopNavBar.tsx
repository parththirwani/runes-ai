import { Menu, FileText, Save, Play, Sparkles, Edit2, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Button from '../design/Button';
import IconButton from '../design/IconButton';
import Logo from '../brand/logo';
import ViewModeToggle from './ViewModeToggle';
import type { DocumentFormatValue } from '@/src/types/compilation';

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
  format?: DocumentFormatValue;
  /** File extension cue, e.g. "notes.md". */
  fileName?: string;
  /** When set, a source download button is shown (Markdown ".md" file). */
  onDownloadSource?: () => void;
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
  compilationStatus = '',
  format = 'LATEX',
  fileName,
  onDownloadSource
}: TopNavBarProps) {
  const router = useRouter();
  const isMarkdown = format === 'MARKDOWN';
  const viewLabels = isMarkdown
    ? { editor: 'Source', split: 'Split', preview: 'Reading' }
    : { editor: 'Code', split: 'Split', preview: 'PDF' };

  return (
    <div className="min-h-14 bg-surface border-b border-border flex flex-wrap items-center justify-between gap-2 px-4 py-2 relative z-30 shrink-0">
      {/* Left Section */}
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:gap-4">
        <IconButton
          icon={<Menu className="w-5 h-5" />}
          onClick={onMenuToggle}
          label="Toggle file tree"
          tooltip="Toggle file tree"
          className="cursor-pointer"
        />
        
        <button
          onClick={() => router.push('/document')}
          aria-label="Back to documents"
          className="flex cursor-pointer items-center transition-opacity hover:opacity-80"
        >
          <Logo variant="wordmark" size="sm" className="hidden sm:block" />
          <Logo variant="mark" size="sm" className="sm:hidden" alt="Runes AI" />
        </button>
        
        <div className="h-6 w-px bg-border" />
        
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground sm:flex-initial">
          <FileText className="w-4 h-4 shrink-0 text-meta" />
          <button
            onClick={onTitleEdit}
            className="flex min-w-0 max-w-50 items-center gap-1 truncate text-foreground hover:text-action transition-colors group cursor-pointer"
            title="Click to edit title"
          >
            <span className="truncate">{documentTitle}</span>
            <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          {hasUnsavedChanges && (
            <span className="w-2 h-2 bg-status-unsaved rounded-full" title="Unsaved changes" aria-hidden="true" />
          )}
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
              isMarkdown
                ? 'border-status-compiling/25 bg-status-compilingSoft text-status-compiling'
                : 'border-status-unsaved/25 bg-status-unsavedSoft text-status-unsaved'
            }`}
          >
            {isMarkdown ? 'Markdown' : 'LaTeX'}
            {fileName ? <span className="ml-1 hidden font-mono sm:inline">{fileName}</span> : null}
          </span>
        </div>
      </div>

      {/* Right Section */}
      <div className="flex max-w-full flex-wrap items-center gap-1 sm:gap-2">
        <ViewModeToggle value={viewMode} onChange={onViewModeChange} labels={viewLabels} />
        {onDownloadSource && (
          <IconButton
            icon={<Download className="w-4 h-4" />}
            label={`Download ${fileName || 'source'} file`}
            tooltip={`Download ${fileName || 'source'} file`}
            onClick={onDownloadSource}
            className="cursor-pointer"
          />
        )}
        
        <div className="hidden h-6 w-px bg-border sm:block" />

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
          label="AI workspace"
          tooltip="AI workspace"
          onClick={onSettingsToggle}
          className="cursor-pointer"
        />
      </div>
    </div>
  );
}
