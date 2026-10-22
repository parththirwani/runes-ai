import type { DocumentFormatValue } from '@/src/types/compilation';

export type FormatFilterValue = 'ALL' | DocumentFormatValue;

interface FormatFilterProps {
  value: FormatFilterValue;
  onChange: (value: FormatFilterValue) => void;
  counts: Record<FormatFilterValue, number>;
}

const OPTIONS: { id: FormatFilterValue; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'MARKDOWN', label: 'Markdown' },
  { id: 'LATEX', label: 'LaTeX' },
];

export default function FormatFilter({ value, onChange, counts }: FormatFilterProps) {
  return (
    <div role="group" aria-label="Filter documents by format" className="flex items-center gap-1.5">
      {OPTIONS.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.id)}
            className={`px-3 py-1.5 rounded-full text-xs border transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-500 ${
              selected
                ? 'bg-emerald-600 border-emerald-500 text-white'
                : 'bg-transparent border-white/15 text-gray-400 hover:text-white hover:border-white/30'
            }`}
          >
            {option.label}
            <span className="ml-1.5 tabular-nums opacity-70">{counts[option.id]}</span>
          </button>
        );
      })}
    </div>
  );
}
