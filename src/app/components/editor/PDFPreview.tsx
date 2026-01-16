import React, { useState } from 'react';
import { FileText, Download, ZoomIn, ZoomOut, Maximize2, Minimize2, Clock } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

interface PDFPreviewProps {
  pdfUrl?: string;
  isLoading?: boolean;
  onCompile?: () => void;
  onDownload?: () => void;
  statusMessage?: string;
}

export default function PDFPreview({
  pdfUrl,
  isLoading = false,
  onCompile,
  onDownload,
  statusMessage = ''
}: PDFPreviewProps) {
  const [zoom, setZoom] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  return (
    <div className="h-full w-full bg-[#2a2a2e] flex flex-col">
      {/* Preview Toolbar */}
      <div className="h-12 bg-[#2d2d2d] border-b border-[#3e3e3e] flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">PDF Preview</span>
          {isLoading && statusMessage && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
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
            tooltip="Zoom out"
            disabled={zoom <= 50}
            className="cursor-pointer"
          />
          <button
            onClick={handleResetZoom}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white min-w-15 text-center transition-colors cursor-pointer"
            title="Reset zoom"
          >
            {zoom}%
          </button>
          <IconButton
            icon={<ZoomIn className="w-4 h-4" />}
            size="sm"
            onClick={handleZoomIn}
            tooltip="Zoom in"
            disabled={zoom >= 200}
            className="cursor-pointer"
          />
          
          <div className="h-6 w-px bg-[#3e3e3e] mx-1" />
          
          {/* Fullscreen Toggle */}
          <IconButton
            icon={isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            size="sm"
            onClick={handleFullscreen}
            tooltip={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="cursor-pointer"
          />
          
          {/* Download */}
          <IconButton
            icon={<Download className="w-4 h-4" />}
            size="sm"
            onClick={onDownload}
            tooltip="Download PDF"
            disabled={!pdfUrl}
            className="cursor-pointer"
          />
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 overflow-auto bg-[#2a2a2e] flex items-center justify-center p-8 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-[#2a2a2e] hover:scrollbar-thumb-gray-500">
        {isLoading ? (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
            <p className="text-gray-400 text-sm mb-2">
              {statusMessage || 'Compiling your document...'}
            </p>
            <p className="text-gray-600 text-xs">
              This may take a few moments
            </p>
          </div>
        ) : pdfUrl ? (
          <div 
            className="shadow-2xl transition-all duration-300"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'center top'
            }}
          >
            <iframe
              src={`${pdfUrl}#view=FitH`}
              className="w-204 h-264 border-0 block bg-white"
              title="PDF Preview"
            />
          </div>
        ) : (
          <div className="text-center max-w-md">
            <div className="w-48 h-64 bg-gray-700 rounded-lg shadow-lg mx-auto mb-6 flex items-center justify-center">
              <FileText className="w-20 h-20 text-gray-600" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">
              No PDF Generated Yet
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              Click the compile button to generate a PDF preview of your LaTeX document
            </p>
            <Button
              variant="primary"
              onClick={onCompile}
              icon={<FileText className="w-4 h-4" />}
            >
              Compile Document
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}