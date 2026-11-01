import { Menu, FileText, Play, Sparkles, Edit2, Download, Share2, ArrowRightLeft, MoreHorizontal, ImagePlus, Save } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useRouter } from 'next/navigation';
import Button from '../design/Button';
import IconButton from '../design/IconButton';
import Logo from '../brand/logo';
import ViewModeToggle from './ViewModeToggle';
import type { ViewMode } from './ViewModeToggle';
import type { DocumentFormatValue } from '@/src/types/compilation';

interface TopNavBarProps {
  documentTitle: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onMenuToggle: () => void;
  onCompile: () => void;
  onSettingsToggle?: () => void;
  onTitleEdit?: () => void;
  isSaving?: boolean;
  justSaved?: boolean;
  isCompiling?: boolean;
  hasUnsavedChanges?: boolean;
  compilationStatus?: string;
  format?: DocumentFormatValue;
  /** File extension cue, e.g. "notes.md". */
  fileName?: string;
  /** Downloads the document's main source file. */
  onDownloadSource?: () => void;
  onSave?: () => void;
  onInsertImage?: () => void;
  canInsertImage?: boolean;
  /** False for a reader: every write control is then absent, not merely disabled. */
  canEdit?: boolean;
  canShare?: boolean;
  authorName?: string | null;
  onShare?: () => void;
  onMove?: () => void;
}

const menuItemClass = 'flex cursor-pointer items-center gap-2 rounded px-2.5 py-2 text-sm text-foreground outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-surface-raised';

export default function TopNavBar({
  documentTitle,
  viewMode,
  onViewModeChange,
  onMenuToggle,
  onCompile,
  onSettingsToggle,
  onTitleEdit,
  isSaving = false,
  justSaved = false,
  isCompiling = false,
  hasUnsavedChanges = false,
  compilationStatus = '',
  format = 'LATEX',
  fileName,
  onDownloadSource,
  onSave,
  onInsertImage,
  canInsertImage = false,
  canEdit = true,
  canShare = false,
  authorName,
  onShare,
  onMove
}: TopNavBarProps) {
  const router = useRouter();
  const isMarkdown = format === 'MARKDOWN';

  return (
    <div className="min-h-12 bg-surface border-b border-border flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 relative z-30 shrink-0">
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
          className="flex shrink-0 cursor-pointer items-center transition-opacity hover:opacity-80"
        >
          <Logo variant="wordmark" size="sm" />
        </button>
        
        <div className="h-6 w-px bg-border" />
        
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground sm:flex-initial">
          <FileText className="w-4 h-4 shrink-0 text-meta" />
          {canEdit ? (
            <button
              onClick={onTitleEdit}
              className="flex min-w-0 max-w-50 items-center gap-1 truncate text-foreground hover:text-action transition-colors group cursor-pointer"
              title="Click to edit title"
            >
              <span className="truncate">{documentTitle}</span>
              <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ) : (
            <span className="flex min-w-0 max-w-50 items-center gap-1 truncate text-foreground">
              <span className="truncate">{documentTitle}</span>
            </span>
          )}
          {hasUnsavedChanges && (
            <span className="w-2 h-2 bg-status-unsaved rounded-full" title="Unsaved changes" aria-hidden="true" />
          )}
          {!canEdit && (
            <span className="shrink-0 text-xs font-medium text-muted-foreground" role="status">
              View-only{authorName ? ` shared by ` : ''}
            </span>
          )}
          {canEdit && (isSaving || justSaved) && (
            <span className="shrink-0 text-xs font-medium text-status-saved" role="status">
              {isSaving ? 'Saving…' : 'Saved'}
            </span>
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
        <ViewModeToggle
          value={viewMode}
          onChange={onViewModeChange}
          labels={{ preview: isMarkdown ? 'Reading' : 'Preview' }}
        />
        {canEdit && (
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
        )}

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label="More document actions" title="More actions" className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-action">
              <MoreHorizontal className="size-5" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={6} className="z-[70] min-w-48 rounded-lg border border-border bg-surface-overlay p-1 shadow-overlay">
              {canShare && onShare && (
                <DropdownMenu.Item onSelect={onShare} className={menuItemClass}>
                  <Share2 className="size-4 text-meta" aria-hidden="true" />Share
                </DropdownMenu.Item>
              )}
              {onMove && (
                <DropdownMenu.Item onSelect={onMove} className={menuItemClass}>
                  <ArrowRightLeft className="size-4 text-meta" aria-hidden="true" />Move document
                </DropdownMenu.Item>
              )}
              {isMarkdown && canEdit && onInsertImage && (
                <DropdownMenu.Item disabled={!canInsertImage} onSelect={onInsertImage} className={menuItemClass}>
                  <ImagePlus className="size-4 text-meta" aria-hidden="true" />Insert image
                </DropdownMenu.Item>
              )}
              {canEdit && onSave && (
                <DropdownMenu.Item onSelect={onSave} className={menuItemClass}>
                  <Save className="size-4 text-meta" aria-hidden="true" />Save draft
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item disabled={!onDownloadSource} onSelect={onDownloadSource} className={menuItemClass}>
                <Download className="size-4 text-meta" aria-hidden="true" />Download source
              </DropdownMenu.Item>
              {canEdit && onSettingsToggle && <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item onSelect={onSettingsToggle} className={menuItemClass}>
                  <Sparkles className="size-4 text-meta" aria-hidden="true" />Writing tools
                </DropdownMenu.Item>
              </>}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
