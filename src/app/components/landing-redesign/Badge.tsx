import { type HTMLAttributes } from 'react';

type Tone =
  | 'neutral'
  | 'action'
  | 'saved'
  | 'unsaved'
  | 'compiling'
  | 'stale'
  | 'error';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

const tones: Record<Tone, { wrap: string; dot: string }> = {
  neutral: { wrap: 'bg-canvas text-ink-soft border-line', dot: 'bg-ink-muted' },
  action: { wrap: 'bg-action-soft text-action border-action/20', dot: 'bg-action' },
  saved: { wrap: 'bg-status-savedSoft text-status-saved border-status-saved/20', dot: 'bg-status-saved' },
  unsaved: { wrap: 'bg-status-unsavedSoft text-status-unsaved border-status-unsaved/20', dot: 'bg-status-unsaved' },
  compiling: { wrap: 'bg-status-compilingSoft text-status-compiling border-status-compiling/20', dot: 'bg-status-compiling' },
  stale: { wrap: 'bg-status-staleSoft text-status-stale border-status-stale/20', dot: 'bg-status-stale' },
  error: { wrap: 'bg-status-errorSoft text-status-error border-status-error/20', dot: 'bg-status-error' },
};

export default function Badge({
  tone = 'neutral',
  dot = false,
  className = '',
  children,
  ...props
}: BadgeProps) {
  const t = tones[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${t.wrap} ${className}`}
      {...props}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />}
      {children}
    </span>
  );
}
