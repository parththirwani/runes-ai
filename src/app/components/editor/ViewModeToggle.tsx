import React from 'react';
import { Code, Eye, Split } from 'lucide-react';

type ViewMode = 'editor' | 'split' | 'preview';

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  const modes: { id: ViewMode; icon: React.ReactNode; label: string }[] = [
    { id: 'editor', icon: <Code className="w-4 h-4" />, label: 'Code' },
    { id: 'split', icon: <Split className="w-4 h-4" />, label: 'Split' },
    { id: 'preview', icon: <Eye className="w-4 h-4" />, label: 'Preview' }
  ];

  return (
    <div className="flex bg-[#3e3e3e] rounded-lg p-1">
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onChange(mode.id)}
          className={`px-3 py-1.5 rounded-md text-xs transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
            value === mode.id
              ? 'bg-emerald-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-[#4e4e4e]'
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