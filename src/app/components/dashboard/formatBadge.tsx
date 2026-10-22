import type { DocumentFormatValue } from '@/src/types/compilation';

interface FormatBadgeProps {
  format?: DocumentFormatValue;
}

/**
 * Text-based format badge. Readable without relying on color or icon shape:
 * the format name and file extension are always spelled out.
 */
export default function FormatBadge({ format }: FormatBadgeProps) {
  const isMarkdown = format === 'MARKDOWN';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${
        isMarkdown
          ? 'border-sky-400/40 bg-sky-400/10 text-sky-300'
          : 'border-amber-400/40 bg-amber-400/10 text-amber-300'
      }`}
    >
      {isMarkdown ? 'Markdown .md' : 'LaTeX .tex'}
    </span>
  );
}
