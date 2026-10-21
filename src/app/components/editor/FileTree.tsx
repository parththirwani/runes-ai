import React, { useState } from 'react';
import { X, Plus, FileText, ChevronRight, ChevronDown, ListTree } from 'lucide-react';
import Button from '../design/Button';
import IconButton from '../design/IconButton';
import type { LatexOutlineNode } from '@/src/lib/latex-outline';

type FileNode = LatexOutlineNode;

interface FileTreeProps {
  isOpen: boolean;
  onClose: () => void;
  files?: FileNode[];
  onFileSelect?: (file: FileNode) => void;
  onNewFile?: () => void;
  title?: string;
  emptyMessage?: string;
}

const FileIcon = ({ type }: { type: string }) => {
  if (type === 'file') return <FileText className="w-4 h-4 text-blue-400" />;
  return <ListTree className="w-4 h-4 text-emerald-400" />;
};

const FileTreeItem = ({ 
  file, 
  level = 0, 
  onSelect 
}: { 
  file: FileNode; 
  level?: number; 
  onSelect?: (file: FileNode) => void;
}) => {
  const [isExpanded, setIsExpanded] = useState(file.expanded || file.active || level < 2);
  const hasChildren = file.children && file.children.length > 0;
  const effectiveExpanded = hasChildren && (file.expanded || file.active || isExpanded);

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) {
            setIsExpanded(!isExpanded);
          } else {
            onSelect?.(file);
          }
        }}
        className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-[#2a2d2e] transition-colors ${
          file.active ? 'bg-[#37373d] text-white ring-1 ring-emerald-500/40' : 'text-gray-300'
        }`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        title={file.type === 'section' ? `Jump to line ${file.lineNumber}` : file.name}
      >
        {hasChildren && (
          <span className="shrink-0 text-gray-500">
            {effectiveExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        {!hasChildren && <span className="w-3 shrink-0" />}
        <FileIcon type={file.type} />
        <span className="truncate flex-1">{file.name}</span>
        {file.type === 'section' && (
          <span className="text-[10px] text-gray-500 tabular-nums">L{file.lineNumber}</span>
        )}
      </button>
      
      {hasChildren && effectiveExpanded && (
        <div>
          {file.children?.map((child) => (
            <FileTreeItem
              key={child.id}
              file={child}
              level={level + 1}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function FileTree({
  isOpen,
  onClose,
  files = [],
  onFileSelect,
  onNewFile,
  title = 'Outline',
  emptyMessage = 'Add a section heading to generate a document outline.'
}: FileTreeProps) {
  const fileList = files;
  const canCreate = typeof onNewFile === 'function';

  return (
    <div
      className={`absolute top-0 left-0 bottom-0 w-64 bg-[#252526] border-r border-[#3e3e3e] transform transition-transform duration-300 z-20 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="h-14 border-b border-[#3e3e3e] flex items-center justify-between px-4">
          <span className="text-white font-semibold text-sm">{title}</span>
          <IconButton
            icon={<X className="w-4 h-4" />}
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          {fileList.length > 0 ? (
            fileList.map((file) => (
              <FileTreeItem key={file.id} file={file} onSelect={onFileSelect} />
            ))
          ) : (
            <div className="px-3 py-4 text-xs leading-5 text-gray-500">
              {emptyMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-[#3e3e3e]">
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={onNewFile}
            className="w-full"
            disabled={!canCreate}
          >
            New Document
          </Button>
        </div>
      </div>

      <style jsx>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #3e3e3e;
          border-radius: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #4e4e4e;
        }
      `}</style>
    </div>
  );
}
