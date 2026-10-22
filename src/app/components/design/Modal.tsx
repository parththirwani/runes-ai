import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl'
};

export default function Modal({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md'
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = () =>
      Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    const initial = focusables()[0];
    initial?.focus();

    // Everything outside the dialog subtree stops receiving pointer,
    // keyboard and screen-reader interaction while it is open.
    const background = Array.from(document.body.children).filter(
      (node) => node instanceof HTMLElement && !node.contains(panelRef.current)
    ) as HTMLElement[];
    background.forEach((node) => node.setAttribute('inert', ''));

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panelRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      background.forEach((node) => node.removeAttribute('inert'));
      if (previouslyFocused.current?.isConnected) {
        previouslyFocused.current.focus();
      } else {
        // The trigger unmounted while the dialog was open (e.g. an error
        // dialog raised from another dialog). Land on the page main region.
        const main = document.querySelector('main');
        if (main) {
          main.setAttribute('tabindex', '-1');
          (main as HTMLElement).focus({ preventScroll: true });
        }
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Portalled to <body> so every sibling of the dialog can be marked inert
  // and the page behind it cannot be interacted with at all.
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          aria-describedby={description ? 'modal-description' : undefined}
          className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${sizeClasses[size]} flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-overlay`}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
            <div>
              <h2 id="modal-title" className="text-base font-semibold text-foreground">
                {title}
              </h2>
              {description && (
                <p id="modal-description" className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto px-5 py-5">{children}</div>

          {footer && (
            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle bg-surface-raised/40 px-5 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
