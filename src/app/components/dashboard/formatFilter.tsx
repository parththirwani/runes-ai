import type { DocumentFormatValue } from '@/src/types/compilation';

export type FormatFilterValue = 'ALL' | 'FAVORITES' | DocumentFormatValue;

interface FormatFilterProps {
  value: FormatFilterValue;
  onChange: (value: FormatFilterValue) => void;
  counts: Record<FormatFilterValue, number>;
}

const OPTIONS: { id: FormatFilterValue; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'FAVORITES', label: 'Favorites' },
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
            className={`min-h-11 rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
              selected
                ? 'border-action bg-action text-white'
                : 'border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink'
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
