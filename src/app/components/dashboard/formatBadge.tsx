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
          ? 'border-status-compiling/25 bg-status-compilingSoft text-status-compiling'
          : 'border-status-unsaved/25 bg-status-unsavedSoft text-status-unsaved'
      }`}
    >
      {isMarkdown ? 'Markdown .md' : 'LaTeX .tex'}
    </span>
  );
}
