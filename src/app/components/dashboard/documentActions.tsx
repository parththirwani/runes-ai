"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import type { DashboardDocument } from "@/src/types/dashboard";
import { DOCUMENT_PATH } from "@/src/lib/paths";

interface DocumentActionsProps {
  document: DashboardDocument;
  onDelete: (document: DashboardDocument) => void;
}

/**
 * Named document actions. Delete used to be a hover-only trash icon that
 * neither touch nor keyboard users could reach. This is a real menu button;
 * the confirmation step itself is handled by the caller.
 */
export default function DocumentActions({ document: doc, onDelete }: DocumentActionsProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const stop = (event: React.MouseEvent) => event.stopPropagation();

  return (
    <div ref={wrapperRef} className="relative shrink-0" onClick={stop}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${doc.title}`}
        className="inline-flex size-9 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${doc.title}`}
          className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-md border border-border bg-surface-overlay shadow-overlay"
        >
          <Link
            href={DOCUMENT_PATH(doc.slug)}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PencilLine className="h-4 w-4 text-meta" aria-hidden="true" />
            Open and edit
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              buttonRef.current?.focus();
              onDelete(doc);
            }}
            className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2.5 text-left text-sm text-destructive transition-colors hover:bg-destructive-subtle"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete document
          </button>
        </div>
      )}
    </div>
  );
}
