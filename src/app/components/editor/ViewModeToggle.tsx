import React from 'react';
import { Code, Eye, Split } from 'lucide-react';

type ViewMode = 'editor' | 'split' | 'preview';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
  /** Format-specific labels; Markdown renames Preview to Reading. */
  labels?: Partial<Record<ViewMode, string>>;
}

export default function ViewModeToggle({ value, onChange, labels }: ViewModeToggleProps) {
  const modes: { id: ViewMode; icon: React.ReactNode; label: string }[] = [
    { id: 'editor', icon: <Code className="w-4 h-4" />, label: labels?.editor ?? 'Code' },
    { id: 'split', icon: <Split className="w-4 h-4" />, label: labels?.split ?? 'Split' },
    { id: 'preview', icon: <Eye className="w-4 h-4" />, label: labels?.preview ?? 'Preview' }
  ];

  return (
    <div className="flex bg-surface-raised border border-border rounded-lg p-1">
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onChange(mode.id)}
          className={`px-3 py-1.5 rounded-md text-xs transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
            value === mode.id
              ? 'bg-action text-white shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-surface'
          }`}
          title={mode.label}
        >
          {mode.icon}
          <span className="hidden sm:inline">{mode.label}</span>
        </button>
      ))}
    </div>
  );
}