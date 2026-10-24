import React from 'react';
import { Sparkles, Wand2, Zap, CheckCircle2, AlertTriangle, XCircle, Clock3, FileDown, Play } from 'lucide-react';
import Button from '../design/Button';

interface AiWorkspacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  autocompleteEnabled: boolean;
  onAutocompleteEnabledChange: (enabled: boolean) => void;
  onParaphrase: (tone?: string) => void;
  paraphraseDisabledReason?: string | null;
  isAiLoading?: boolean;
  aiError?: string | null;
  autocompleteNotice?: string | null;
  hasProposal?: boolean;
  lastTone?: string;
  pdfIsStale?: boolean;
  hasPdf?: boolean;
  hasUnsavedChanges?: boolean;
  onCompile: () => void;
  onSave: () => void;
  onDownloadPdf: () => void;
  isMarkdown?: boolean;
}

const TONES = ['Clearer', 'Shorter', 'Formal'] as const;

export default function AiWorkspacePanel({
  isOpen,
  onClose,
  autocompleteEnabled,
  onAutocompleteEnabledChange,
  onParaphrase,
  paraphraseDisabledReason,
  isAiLoading = false,
  aiError,
  autocompleteNotice,
  hasProposal = false,
  lastTone = 'Clearer',
  pdfIsStale = false,
  hasPdf = false,
  hasUnsavedChanges = false,
  onCompile,
  onSave,
  onDownloadPdf,
  isMarkdown = false,
}: AiWorkspacePanelProps) {
  const status = hasProposal
    ? { icon: <CheckCircle2 className="w-4 h-4 text-action" />, label: 'Proposal ready', detail: 'Review the diff below the editor.' }
    : isAiLoading
      ? { icon: <Clock3 className="w-4 h-4 text-status-compiling" />, label: 'AI thinking', detail: 'Keep writing or wait for the current suggestion.' }
      : aiError
        ? { icon: <XCircle className="w-4 h-4 text-status-error" />, label: 'Attention needed', detail: aiError }
        : autocompleteNotice
          ? { icon: <AlertTriangle className="w-4 h-4 text-status-stale" />, label: 'AI limited', detail: autocompleteNotice }
          : { icon: <Sparkles className="w-4 h-4 text-action" />, label: 'AI ready', detail: 'Autocomplete and paraphrase are available in prose.' };

  return (
    <aside
      className={`absolute top-0 right-0 bottom-0 w-80 max-w-[90vw] bg-canvas border-l border-border transform transition-transform duration-300 z-20 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      aria-label="AI workspace"
    >
      <div className="h-full flex flex-col">
        <div className="h-14 border-b border-border px-4 flex items-center justify-between">
          <div>
            <div className="text-foreground font-semibold text-sm">AI workspace</div>
            <div className="text-[11px] text-meta">Native editing controls for this draft</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm transition-colors">Close</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm text-foreground">
          <section className="rounded-lg border border-border bg-surface p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-meta">
              {status.icon}
              <span>{status.label}</span>
            </div>
            <p className="text-sm text-muted-foreground">{status.detail}</p>
          </section>

          <section className="rounded-lg border border-border bg-surface p-3 space-y-3">
            <div>
              <div className="flex items-center gap-2 text-foreground font-medium">
                <Zap className="w-4 h-4 text-action" />
                Inline autocomplete
              </div>
              <p className="mt-1 text-xs text-meta">Ghost text appears only in prose. Press Tab to accept.</p>
            </div>

            <label className="flex items-center justify-between rounded-md bg-surface-raised px-3 py-2 cursor-pointer">
              <span>
                <span className="block text-sm text-foreground">Enable AI complete</span>
                <span className="block text-[11px] text-meta">Session-only preference</span>
              </span>
              <input
                type="checkbox"
                checked={autocompleteEnabled}
                onChange={(event) => onAutocompleteEnabledChange(event.target.checked)}
                className="w-4 h-4 accent-action"
              />
            </label>
          </section>

          <section className="rounded-lg border border-border bg-surface p-3 space-y-3">
            <div>
              <div className="flex items-center gap-2 text-foreground font-medium">
                <Wand2 className="w-4 h-4 text-status-compiling" />
                Selection rewrite
              </div>
              <p className="mt-1 text-xs text-meta">Select prose, then send it to AI without changing {isMarkdown ? 'Markdown syntax' : 'LaTeX structure'}.</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {TONES.map((tone) => (
                <Button
                  key={tone}
                  variant={lastTone === tone ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => onParaphrase(tone)}
                  disabled={isAiLoading || hasProposal || !!paraphraseDisabledReason}
                  title={paraphraseDisabledReason || `Paraphrase selection (${tone})`}
                  className="w-full"
                >
                  {tone}
                </Button>
              ))}
            </div>

            <div className="rounded-md bg-surface-raised px-3 py-2 text-xs text-muted-foreground">
              {paraphraseDisabledReason || 'Ready for the current selection.'}
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface p-3 space-y-3">
            <div className="text-foreground font-medium">Compile loop</div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
                <span>Source status</span>
                <span className={hasUnsavedChanges ? 'text-status-unsaved' : 'text-status-saved'}>{hasUnsavedChanges ? 'Unsaved' : 'Saved'}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-surface-raised px-3 py-2">
                <span>Preview freshness</span>
                <span className={pdfIsStale ? 'text-status-stale' : 'text-status-saved'}>{pdfIsStale ? 'Needs compile' : hasPdf ? 'Current' : 'No PDF yet'}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <Button variant="primary" size="sm" icon={<Play className="w-4 h-4" />} onClick={onCompile}>Compile PDF</Button>
              <Button variant="secondary" size="sm" icon={<Sparkles className="w-4 h-4" />} onClick={onSave}>Save draft</Button>
              <Button variant="secondary" size="sm" icon={<FileDown className="w-4 h-4" />} onClick={onDownloadPdf} disabled={!hasPdf}>Download PDF</Button>
            </div>
          </section>
        </div>
      </div>
    </aside>
  );
}
