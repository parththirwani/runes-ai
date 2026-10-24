import React, { useState } from 'react';
import { FileText, Download, ZoomIn, ZoomOut, Maximize2, Minimize2, Clock } from 'lucide-react';
import Button from '../design/Button';
import IconButton from '../design/IconButton';
import PdfCanvasPreview from './PdfCanvasPreview';

interface PDFPreviewProps {
  pdfUrl?: string;
  isLoading?: boolean;
  onCompile?: () => void;
  onDownload?: () => void;
  statusMessage?: string;
  isStale?: boolean;
  documentKind?: string;
  renderPages?: boolean;
}

export default function PDFPreview({
  pdfUrl,
  isLoading = false,
  onCompile,
  onDownload,
  statusMessage = '',
  isStale = false,
  documentKind = 'LaTeX',
  renderPages = false,
}: PDFPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // NEW: Track if we've ever started compiling → hide empty state after first attempt
  const [hasStartedCompilation, setHasStartedCompilation] = useState(false);

  const handleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  };

  React.useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const handleZoomIn = () => {
    setZoom(prev => Math.min(200, prev + 25));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(50, prev - 25));
  };

  const handleResetZoom = () => {
    setZoom(100);
  };

  // NEW: Call this when user clicks Compile (instead of directly calling onCompile)
  const handleCompileClick = () => {
    setHasStartedCompilation(true); // Once true, stays true
    onCompile?.();
  };

  return (
    <div className="h-full w-full bg-canvas flex flex-col">
      {/* Preview Toolbar */}
      <div className="h-12 bg-surface border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">PDF Preview</span>
          {pdfUrl && !isLoading && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isStale ? 'bg-status-staleSoft text-status-stale' : 'bg-status-savedSoft text-status-saved'}`}>
              {isStale ? 'Outdated' : 'Up to date'}
            </span>
          )}
          {isLoading && statusMessage && (
            <div className="flex items-center gap-2 text-xs text-status-compiling">
              <Clock className="w-3 h-3 animate-pulse" />
              <span>{statusMessage}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Zoom Controls */}
          <IconButton
            icon={<ZoomOut className="w-4 h-4" />}
            size="sm"
            onClick={handleZoomOut}
            label="Zoom out"
            tooltip="Zoom out"
            disabled={zoom <= 50}
            className="cursor-pointer"
          />
          <button
            onClick={handleResetZoom}
            className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground min-w-15 text-center transition-colors cursor-pointer"
            title="Reset zoom"
          >
            {zoom}%
          </button>
          <IconButton
            icon={<ZoomIn className="w-4 h-4" />}
            size="sm"
            onClick={handleZoomIn}
            label="Zoom in"
            tooltip="Zoom in"
            disabled={zoom >= 200}
            className="cursor-pointer"
          />
          <div className="h-6 w-px bg-border mx-1" />
          {/* Fullscreen Toggle */}
          <IconButton
            icon={isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            size="sm"
            onClick={handleFullscreen}
            label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            tooltip={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="cursor-pointer"
          />
          {/* Download */}
          <IconButton
            icon={<Download className="w-4 h-4" />}
            size="sm"
            onClick={onDownload}
            label="Download PDF"
            tooltip="Download PDF"
            disabled={!pdfUrl}
            className="cursor-pointer"
          />
        </div>
      </div>

      {/* Preview Area */}
      <div className={`flex-1 overflow-auto bg-canvas relative ${renderPages && pdfUrl ? '' : 'flex items-center justify-center p-8'}`}>
        {/* Show PDF if available */}
        {pdfUrl && renderPages && <PdfCanvasPreview pdfUrl={pdfUrl} zoom={zoom} />}
        {pdfUrl && !renderPages && (
          <div
            className="shadow-lift transition-all duration-300"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'center top'
            }}
          >
            <iframe
              src={`${pdfUrl}#view=FitH&navpanes=0`}
              className="w-204 h-264 border-0 block bg-white"
              title="PDF Preview"
            />
          </div>
        )}

        {/* Empty state - only show if NEVER started compiling AND no PDF */}
        {!pdfUrl && !hasStartedCompilation && (
          <div className="text-center max-w-md">
            <div className="w-48 h-64 bg-surface border border-border shadow-paper rounded-lg mx-auto mb-6 flex items-center justify-center">
              <FileText className="w-20 h-20 text-meta" />
            </div>
            <h3 className="text-xl font-semibold text-foreground mb-2">
              No PDF Generated Yet
            </h3>
            <p className="text-muted-foreground text-sm mb-6">
              Click the compile button to generate a PDF preview of your {documentKind} document
            </p>
            <Button
              variant="primary"
              onClick={handleCompileClick}  // ← changed to our wrapper
              icon={<FileText className="w-4 h-4" />}
            >
              Compile Document
            </Button>
          </div>
        )}

        {/* Loading overlay - shown when compiling (for first compile AND recompiles) */}
        {isLoading && (
          <div className="absolute inset-0 bg-canvas/85 flex items-center justify-center z-10">
            <div className="text-center rounded-xl border border-border bg-surface px-6 py-5 shadow-soft">
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-action border-t-transparent mx-auto mb-4" />
              <p className="text-foreground text-sm font-medium mb-2">
                {statusMessage || 'Compiling your document...'}
              </p>
              <p className="text-muted-foreground text-xs">
                This may take a few moments
              </p>
            </div>
          </div>
        )}

        {/* Optional: During queue/waiting (isLoading false but hasStarted=true & no pdfUrl) show a waiting message */}
        {!pdfUrl && hasStartedCompilation && !isLoading && (
          <div className="text-center text-muted-foreground">
            <div className="animate-pulse mb-4">
              <Clock className="w-12 h-12 mx-auto text-action" />
            </div>
            <p className="text-lg text-foreground">Job queued – waiting for compilation...</p>
            <p className="text-sm mt-2">Your PDF will appear here once ready</p>
          </div>
        )}
      </div>
    </div>
  );
}
