'use client';

// Real workspace file tree: create, upload, open, rename, move, delete, choose main.
// The section outline is kept as a separate tab so navigation stays available.

import React, { useMemo, useState } from 'react';
import {
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Plus,
  Star,
  Upload,
  Pencil,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react';
import Button from '../design/Button';
import IconButton from '../design/IconButton';
import InputModal from '../design/InputModal';
import type { TreeNode } from '@/src/lib/workspace-paths';
import type { ManagedFile } from '@/src/hooks/useWorkspace';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  tree: TreeNode[];
  files: Record<string, ManagedFile>;
  mainFilePath: string;
  activePath: string;
  dirtyPaths: string[];
  stalePaths: string[];
  slug: string;
  onOpenFile: (path: string) => void;
  onCreateFile: (path: string) => Promise<unknown>;
  onUpload: (path: string, blob: Blob) => Promise<unknown>;
  onRename: (from: string, to: string) => Promise<unknown>;
  onDelete: (path: string) => Promise<unknown>;
  onChooseMain: (path: string) => Promise<unknown>;
  outline: React.ReactNode;
  error: string | null;
  onDismissError: () => void;
};

type ModalState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'rename'; from: string }
  | { kind: 'delete'; path: string };

const FILE_ICONS: Record<string, React.ReactNode> = {
  tex: <FileCode2 className="w-4 h-4 text-blue-400" />,
  bib: <FileText className="w-4 h-4 text-amber-400" />,
  image: <FileImage className="w-4 h-4 text-emerald-400" />,
  other: <FileText className="w-4 h-4 text-gray-400" />,
};

function DirectoryNode({
  node,
  depth,
  expanded,
  toggle,
  children,
}: {
  node: TreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  toggle: (path: string) => void;
  children: React.ReactNode;
}) {
  const isOpen = expanded[node.path] ?? true;
  return (
    <div>
      <button
        type="button"
        onClick={() => toggle(node.path)}
        aria-expanded={isOpen}
        className="w-full text-left flex items-center gap-1.5 px-2 py-1 rounded text-[13px] text-gray-400 hover:bg-[#2a2d2e]"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {isOpen ? <FolderOpen className="w-3.5 h-3.5 text-emerald-500" /> : <Folder className="w-3.5 h-3.5 text-emerald-600" />}
        <span className="truncate">{node.name}</span>
      </button>
      {isOpen && children}
    </div>
  );
}

export default function WorkspacePanel(props: Props) {
  const {
    isOpen, onClose, tree, files, mainFilePath, activePath, dirtyPaths, stalePaths, slug,
    onOpenFile, onCreateFile, onUpload, onRename, onDelete, onChooseMain, outline, error, onDismissError,
  } = props;

  const [tab, setTab] = useState<'files' | 'outline'>('files');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [uploadFolder, setUploadFolder] = useState('figures');

  const dirty = useMemo(() => new Set(dirtyPaths), [dirtyPaths]);
  const stale = useMemo(() => new Set(stalePaths), [stalePaths]);

  const toggle = (path: string) => setExpanded((current) => ({ ...current, [path]: !(current[path] ?? true) }));

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
      setModal({ kind: 'none' });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const renderNodes = (nodes: TreeNode[], depth: number): React.ReactNode =>
    nodes.map((node) => {
      if (node.type === 'directory') {
        return (
          <DirectoryNode key={node.path} node={node} depth={depth} expanded={expanded} toggle={toggle}>
            {renderNodes(node.children || [], depth + 1)}
          </DirectoryNode>
        );
      }

      const file = files[node.path];
      const isMain = node.path === mainFilePath;
      const isActive = node.path === activePath;
      return (
        <div
          key={node.path}
          className={`group flex items-center gap-1 pr-1 rounded hover:bg-[#2a2d2e] ${isActive ? 'bg-[#37373d]' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <button
            type="button"
            onClick={() => onOpenFile(node.path)}
            className="flex-1 min-w-0 flex items-center gap-1.5 py-1 text-left text-[13px] text-gray-200"
            title={node.path}
          >
            {FILE_ICONS[file?.kind || 'other']}
            <span className="truncate">{node.name}</span>
            {dirty.has(node.path) && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" aria-label="Unsaved changes" />}
            {stale.has(node.path) && !dirty.has(node.path) && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" aria-label="Changed since last compile" />}
          </button>
          {isMain && (
            <span title="Main file" aria-label="Main file">
              <Star className="w-3 h-3 text-emerald-400 fill-emerald-400 shrink-0" />
            </span>
          )}
          <div className="hidden group-hover:flex group-focus-within:flex items-center">
            {file?.kind === 'tex' && !isMain && (
              <IconButton
                icon={<Star className="w-3 h-3" />}
                variant="ghost"
                size="sm"
                onClick={() => runAction(() => onChooseMain(node.path))}
                tooltip="Set as main file"
              />
            )}
            <IconButton icon={<Pencil className="w-3 h-3" />} variant="ghost" size="sm" onClick={() => setModal({ kind: 'rename', from: node.path })} tooltip="Rename" />
            <IconButton
              icon={<Trash2 className="w-3 h-3" />}
              variant="ghost"
              size="sm"
              onClick={() => setModal({ kind: 'delete', path: node.path })}
              tooltip="Delete"
            />
          </div>
        </div>
      );
    });

  return (
    <div
      className={`absolute top-0 left-0 bottom-0 w-72 max-[520px]:w-[86vw] bg-[#252526] border-r border-[#3e3e3e] transform transition-transform duration-300 z-20 flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
    >
      <div className="h-14 border-b border-[#3e3e3e] flex items-center justify-between px-3 gap-2 shrink-0">
        <div className="flex items-center gap-1 bg-[#1e1e1e] rounded p-0.5">
          <button
            type="button"
            onClick={() => setTab('files')}
            className={`px-2 py-1 rounded text-xs ${tab === 'files' ? 'bg-[#37373d] text-white' : 'text-gray-400'}`}
          >
            Files
          </button>
          <button
            type="button"
            onClick={() => setTab('outline')}
            className={`px-2 py-1 rounded text-xs ${tab === 'outline' ? 'bg-[#37373d] text-white' : 'text-gray-400'}`}
          >
            Outline
          </button>
        </div>
        <IconButton icon={<X className="w-4 h-4" />} variant="ghost" size="sm" onClick={onClose} tooltip="Close panel" />
      </div>

      {(error || actionError) && (
        <div className="mx-2 mt-2 text-[11px] leading-4 text-yellow-300 bg-yellow-900/30 border border-yellow-700/50 rounded p-2 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{actionError || error}</span>
          <button type="button" onClick={onDismissError} className="text-yellow-400">Dismiss</button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'outline' ? (
          outline
        ) : tree.length === 0 ? (
          <p className="px-2 py-3 text-xs text-gray-500">This workspace is empty. Create main.tex to start compiling.</p>
        ) : (
          <div role="tree" aria-label="Workspace files">{renderNodes(tree, 0)}</div>
        )}
      </div>

      {tab === 'files' && (
        <div className="p-2 border-t border-[#3e3e3e] space-y-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 truncate" title={slug}>{Object.keys(files).length} files</span>
          </div>
          <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} className="w-full" onClick={() => setModal({ kind: 'create' })}>
            New file
          </Button>
          <div className="flex gap-2">
            <input
              value={uploadFolder}
              onChange={(event) => setUploadFolder(event.target.value)}
              aria-label="Upload folder"
              className="min-w-0 flex-1 bg-[#1e1e1e] border border-[#3e3e3e] rounded px-2 py-1 text-[11px] text-gray-300"
              placeholder="figures"
            />
            <label className="flex-1">
              <span className="sr-only">Upload a file</span>
              <input
                type="file"
                className="hidden"
                onChange={(event) => {
                  const picked = event.target.files?.[0];
                  if (!picked) return;
                  const name = picked.name.replace(/^\/+/, '');
                  const folder = uploadFolder.trim().replace(/^\/+|\/+$/g, '');
                  void runAction(() => onUpload(folder ? folder + '/' + name : name, picked));
                  event.target.value = '';
                }}
              />
              <span className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-[#3e3e3e] hover:bg-[#4a4a4a] text-gray-200 text-xs px-3 py-1.5 cursor-pointer">
                <Upload className="w-3.5 h-3.5" /> Upload
              </span>
            </label>
          </div>
        </div>
      )}

      <InputModal
        isOpen={modal.kind === 'create'}
        onClose={() => setModal({ kind: 'none' })}
        onSubmit={(value) => void runAction(() => onCreateFile(value))}
        title="New file"
        description="Use a path inside the workspace, for example chapters/methods.tex"
        placeholder="chapters/methods.tex"
        submitText="Create"
        maxLength={300}
        validation={(value: string) => {
          if (!value || value.length < 3) return 'Enter a file name';
          if (!/\.(tex|bib|txt)$/i.test(value)) return 'Use a .tex, .bib or .txt name';
          return null;
        }}
      />

      <InputModal
        isOpen={modal.kind === 'rename'}
        onClose={() => setModal({ kind: 'none' })}
        onSubmit={(value) => modal.kind === 'rename' && void runAction(() => onRename(modal.from, value))}
        title="Rename or move"
        description="Give the new path. Moving folders works too."
        placeholder="chapters/related-work.tex"
        submitText="Move"
        maxLength={300}
        defaultValue={modal.kind === 'rename' ? modal.from : ''}
        validation={(value: string) => (value && value.length > 2 ? null : 'Enter a new path')}
      />

      <InputModal
        isOpen={modal.kind === 'delete'}
        onClose={() => setModal({ kind: 'none' })}
        onSubmit={() => modal.kind === 'delete' && void runAction(() => onDelete(modal.path))}
        title="Delete file"
        description={modal.kind === 'delete' ? 'Type DELETE to remove ' + modal.path : ''}
        placeholder="DELETE"
        submitText="Delete"
        maxLength={300}
        validation={(value: string) => (value === 'DELETE' ? null : 'Type DELETE to confirm')}
      />
    </div>
  );
}
