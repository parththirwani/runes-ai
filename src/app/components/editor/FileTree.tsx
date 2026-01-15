import React, { useState } from 'react';
import { X, Plus, FileText, FolderOpen, Folder, ChevronRight, ChevronDown, Image, File } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

interface FileNode {
  id: string;
  name: string;
  type: 'file' | 'folder';
  active?: boolean;
  children?: FileNode[];
}

interface FileTreeProps {
  isOpen: boolean;
  onClose: () => void;
  files?: FileNode[];
  onFileSelect?: (file: FileNode) => void;
  onNewFile?: () => void;
}

const FileIcon = ({ name, type }: { name: string; type: string }) => {
  if (type === 'folder') return <FolderOpen className="w-4 h-4 text-yellow-500" />;
  
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'tex') return <FileText className="w-4 h-4 text-blue-400" />;
  if (['png', 'jpg', 'jpeg', 'svg'].includes(ext || '')) return <Image className="w-4 h-4 text-green-400" />;
  if (ext === 'bib') return <FileText className="w-4 h-4 text-purple-400" />;
  return <File className="w-4 h-4 text-gray-400" />;
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
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = file.children && file.children.length > 0;

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
          file.active ? 'bg-[#37373d] text-white' : 'text-gray-300'
        }`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
      >
        {hasChildren && (
          <span className="shrink-0">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        <FileIcon name={file.name} type={file.type} />
        <span className="truncate flex-1">{file.name}</span>
      </button>
      
      {hasChildren && isExpanded && (
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
  onNewFile
}: FileTreeProps) {
  const defaultFiles: FileNode[] = [
    { id: '1', name: 'main.tex', type: 'file', active: true },
    { id: '2', name: 'references.bib', type: 'file' },
    {
      id: '3',
      name: 'images',
      type: 'folder',
      children: [
        { id: '3-1', name: 'figure1.png', type: 'file' },
        { id: '3-2', name: 'logo.svg', type: 'file' }
      ]
    },
    { id: '4', name: 'chapters', type: 'folder', children: [] }
  ];

  const fileList = files.length > 0 ? files : defaultFiles;

  return (
    <div
      className={`absolute top-0 left-0 bottom-0 w-64 bg-[#252526] border-r border-[#3e3e3e] transform transition-transform duration-300 z-20 ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="h-14 border-b border-[#3e3e3e] flex items-center justify-between px-4">
          <span className="text-white font-semibold text-sm">Files</span>
          <IconButton
            icon={<X className="w-4 h-4" />}
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </div>

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          {fileList.map((file) => (
            <FileTreeItem key={file.id} file={file} onSelect={onFileSelect} />
          ))}
        </div>

        {/* Footer */}
        <div className="p-2 border-t border-[#3e3e3e]">
          <Button
            variant="primary"
            size="sm"
            icon={<Plus className="w-4 h-4" />}
            onClick={onNewFile}
            className="w-full"
          >
            New File
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