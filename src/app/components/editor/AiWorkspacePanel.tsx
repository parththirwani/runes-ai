import React from 'react';
import { X } from 'lucide-react';

interface AiWorkspacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  autocompleteEnabled: boolean;
  onAutocompleteEnabledChange: (enabled: boolean) => void;
  onParaphrase: () => void;
  paraphraseDisabledReason?: string | null;
  isAiLoading?: boolean;
  hasProposal?: boolean;
}

export default function AiWorkspacePanel({
  isOpen,
  onClose,
  autocompleteEnabled,
  onAutocompleteEnabledChange,
  onParaphrase,
  paraphraseDisabledReason,
  isAiLoading = false,
  hasProposal = false,
}: AiWorkspacePanelProps) {
  if (!isOpen) return null;

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 w-72 max-w-[90vw] border-l border-border bg-surface"
      aria-label="Writing tools"
      onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Writing tools</h2>
        <button type="button" onClick={onClose} aria-label="Close writing tools" className="rounded p-1 text-meta hover:bg-surface-raised hover:text-foreground">
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <div className="space-y-5 p-4 text-sm">
        <label className="flex cursor-pointer items-start justify-between gap-3">
          <span>
            <span className="block font-medium text-foreground">AI autocomplete</span>
            <span className="mt-0.5 block text-xs leading-5 text-meta">Suggests prose as you type. Press Tab to accept.</span>
          </span>
          <input type="checkbox" autoFocus checked={autocompleteEnabled} onChange={(event) => onAutocompleteEnabledChange(event.target.checked)} className="mt-1 size-4 shrink-0 accent-action" />
        </label>
        <div className="border-t border-border pt-4">
          <p className="font-medium text-foreground">Rewrite selected text</p>
          <p className="mt-1 text-xs leading-5 text-meta">Select prose to use the inline Edit control or Ctrl/Cmd+K.</p>
          <button
            type="button"
            onClick={onParaphrase}
            disabled={isAiLoading || hasProposal || !!paraphraseDisabledReason}
            title={paraphraseDisabledReason || 'Paraphrase selection'}
            className="mt-3 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
          >
            Paraphrase selection
          </button>
        </div>
      </div>
    </aside>
  );
}
