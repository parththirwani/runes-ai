"use client";

// Markdown right-hand pane: tabs for the live reading preview and the PDF
// from the last successful compile. The reading preview always reflects the
// current source; only the PDF tab can be stale.

import React, { useEffect, useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import PDFPreview from './PDFPreview';

type PreviewTab = 'reading' | 'pdf';

interface MarkdownPreviewPaneProps {
  source: string;
  pdfUrl?: string;
  isCompiling: boolean;
  compilationStatus: string;
  pdfIsStale: boolean;
  onCompile: () => void;
  onDownloadPdf: () => void;
}

export default function MarkdownPreviewPane({
  source,
  pdfUrl,
  isCompiling,
  compilationStatus,
  pdfIsStale,
  onCompile,
  onDownloadPdf,
}: MarkdownPreviewPaneProps) {
  const [tab, setTab] = useState<PreviewTab>('reading');
  const [previewSource, setPreviewSource] = useState(source);

  // Short debounce keeps typing smooth without re-rendering the preview on
  // every keystroke; Monaco is not remounted here at all.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewSource(source), 250);
    return () => clearTimeout(timer);
  }, [source]);

  return (
    <div className="h-full flex flex-col bg-canvas">
      <div role="tablist" aria-label="Markdown preview mode" className="flex items-center gap-1 px-3 py-2 bg-surface border-b border-border shrink-0">
        <button
          role="tab"
          aria-selected={tab === 'reading'}
          onClick={() => setTab('reading')}
          className={`px-3 py-1.5 rounded-md text-xs cursor-pointer ${
            tab === 'reading' ? 'bg-action text-white' : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised'
          }`}
        >
          Reading preview
        </button>
        <button
          role="tab"
          aria-selected={tab === 'pdf'}
          onClick={() => setTab('pdf')}
          className={`px-3 py-1.5 rounded-md text-xs cursor-pointer flex items-center gap-1.5 ${
            tab === 'pdf' ? 'bg-action text-white' : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised'
          }`}
        >
          PDF
          {tab === 'pdf' && pdfIsStale && pdfUrl && (
            <span className="rounded-full bg-status-staleSoft px-1.5 py-0.5 text-[9px] text-status-stale">Outdated</span>
          )}
        </button>
      </div>

      {tab === 'reading' ? (
        <div className="flex-1 overflow-auto" data-testid="markdown-reading-pane">
          <p className="sr-only">Reading preview of the current source. The PDF tab shows the latest successful compile.</p>
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-meta bg-surface-raised border-b border-border">
            Reading preview — current source
          </div>
          <div className="bg-surface px-6 py-8">
            <div className="mx-auto max-w-2xl">
              <MarkdownPreview source={previewSource} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <PDFPreview
            pdfUrl={pdfUrl}
            isLoading={isCompiling}
            onCompile={onCompile}
            onDownload={onDownloadPdf}
            statusMessage={compilationStatus}
            isStale={pdfIsStale}
            renderPages
          />
        </div>
      )}
    </div>
  );
}
