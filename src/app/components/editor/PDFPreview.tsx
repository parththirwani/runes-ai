import React from 'react';
import { FileText, Download, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

interface PDFPreviewProps {
  pdfUrl?: string;
  isLoading?: boolean;
  onCompile?: () => void;
  onDownload?: () => void;
}

export default function PDFPreview({
  pdfUrl,
  isLoading = false,
  onCompile,
  onDownload
}: PDFPreviewProps) {
  const [zoom, setZoom] = React.useState(100);

  return (
    <div className="h-full w-full bg-gray-900 flex flex-col">
      {/* Preview Toolbar */}
      <div className="h-12 bg-[#2d2d2d] border-b border-[#3e3e3e] flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">PDF Preview</span>
        </div>
        
        <div className="flex items-center gap-2">
          <IconButton
            icon={<ZoomOut className="w-4 h-4" />}
            size="sm"
            onClick={() => setZoom(Math.max(50, zoom - 10))}
            tooltip="Zoom out"
          />
          <span className="text-xs text-gray-400 min-w-12.5 text-center">
            {zoom}%
          </span>
          <IconButton
            icon={<ZoomIn className="w-4 h-4" />}
            size="sm"
            onClick={() => setZoom(Math.min(200, zoom + 10))}
            tooltip="Zoom in"
          />
          
          <div className="h-6 w-px bg-[#3e3e3e] mx-2" />
          
          <IconButton
            icon={<Maximize2 className="w-4 h-4" />}
            size="sm"
            tooltip="Fullscreen"
          />
          <IconButton
            icon={<Download className="w-4 h-4" />}
            size="sm"
            onClick={onDownload}
            tooltip="Download PDF"
          />
        </div>
      </div>

      {/* Preview Area */}
      <div className="flex-1 overflow-auto bg-gray-800 flex items-center justify-center p-8 custom-scrollbar">
        {isLoading ? (
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500 mx-auto mb-4" />
            <p className="text-gray-400 text-sm">Compiling your document...</p>
          </div>
        ) : pdfUrl ? (
          <div 
            className="bg-white shadow-2xl rounded-lg overflow-hidden"
            style={{
              width: `${zoom}%`,
              maxWidth: '100%'
            }}
          >
            <iframe
              src={pdfUrl}
              className="w-full h-200"
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

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #1f2937;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #4b5563;
          border-radius: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #6b7280;
        }
      `}</style>
    </div>
  );
}