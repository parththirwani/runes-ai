'use client';

// Tabs for the open workspace files. Each tab maps to one Monaco model.

import React from 'react';
import { Star, X } from 'lucide-react';
import type { ManagedFile } from '@/src/hooks/useWorkspace';

type Props = {
  openPaths: string[];
  files: Record<string, ManagedFile>;
  activePath: string;
  mainFilePath: string;
  dirtyPaths: string[];
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
};

function fileNameOf(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

export default function FileTabs({ openPaths, files, activePath, mainFilePath, dirtyPaths, onSelect, onClose }: Props) {
  if (openPaths.length === 0) return null;
  const dirty = new Set(dirtyPaths);

  return (
    <div role="tablist" aria-label="Open files" className="flex items-stretch bg-surface-raised border-b border-border overflow-x-auto shrink-0">
      {openPaths.map((path) => {
        const file = files[path];
        const isActive = path === activePath;
        return (
          <div
            key={path}
            role="tab"
            aria-selected={isActive}
            className={`group flex items-center gap-1.5 pl-3 pr-2 py-1.5 text-xs border-r border-border cursor-pointer whitespace-nowrap ${
              isActive ? 'bg-surface text-foreground border-t-2 border-t-action' : 'bg-surface-raised text-muted-foreground hover:bg-surface hover:text-foreground'
            }`}
            title={path}
            onClick={() => onSelect(path)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(path);
              }
            }}
            tabIndex={0}
          >
            {path === mainFilePath && <Star className="w-3 h-3 text-action fill-action shrink-0" aria-label="Main file" />}
            <span className="truncate max-w-40">{fileNameOf(path)}</span>
            {dirty.has(path) && <span className="w-1.5 h-1.5 rounded-full bg-status-unsaved shrink-0" aria-label="Unsaved changes" />}
            {file?.binary && <span className="text-[10px] text-meta">binary</span>}
            <button
              type="button"
              aria-label={'Close ' + path}
              className="text-meta opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                onClose(path);
              }}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
