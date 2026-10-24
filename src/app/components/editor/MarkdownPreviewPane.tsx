"use client";

// Markdown right-hand pane. The navbar selects the live reading preview or
// the last compiled PDF. The reading preview always reflects current source.

import React, { useEffect, useState } from 'react';
import MarkdownPreview from './MarkdownPreview';
import PDFPreview from './PDFPreview';

interface MarkdownPreviewPaneProps {
  source: string;
  tab: 'reading' | 'pdf';
  pdfUrl?: string;
  isCompiling: boolean;
  compilationStatus: string;
  pdfIsStale: boolean;
  onCompile: () => void;
  onDownloadPdf: () => void;
}

export default function MarkdownPreviewPane({
  source,
  tab,
  pdfUrl,
  isCompiling,
  compilationStatus,
  pdfIsStale,
  onCompile,
  onDownloadPdf,
}: MarkdownPreviewPaneProps) {
  const [previewSource, setPreviewSource] = useState(source);

  // Short debounce keeps typing smooth without re-rendering the preview on
  // every keystroke; Monaco is not remounted here at all.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewSource(source), 250);
    return () => clearTimeout(timer);
  }, [source]);

  return (
    <div className="h-full flex flex-col bg-canvas">
      {tab === 'reading' ? (
        <div className="flex-1 overflow-auto" data-testid="markdown-reading-pane">
          <p className="sr-only">Reading preview of the current source. The PDF view shows the latest successful compile.</p>
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
