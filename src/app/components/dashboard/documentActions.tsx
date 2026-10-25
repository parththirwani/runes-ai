"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Download, FolderInput, MoreHorizontal, PencilLine, Share2, Star, StarOff, Trash2 } from "lucide-react";
import { MorphIcon } from "../ui/morph-icon";
import HoldToConfirm from "@/components/arc/hold-to-confirm/hold-to-confirm";
import holdStyles from "@/components/arc/hold-to-confirm/hold-to-confirm.module.css";
import { DOCUMENT_PATH } from "@/src/lib/paths";

interface DocumentActionsProps {
  document: { title: string; slug: string; isFavorite: boolean };
  /**
   * Server-decided capabilities for this row. A reader of a shared document gets a menu with
   * only the things the API will actually accept, so the interface cannot promise a write that
   * the capability service would refuse.
   */
  capabilities?: { canEdit: boolean; canShare: boolean };
  onDelete: () => Promise<void>;
  onFavoriteChange: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onMove?: () => void;
}

/**
 * Named document actions. Delete used to be a hover-only trash icon that
 * neither touch nor keyboard users could reach. This is a real menu button;
 * the confirmation step itself is handled by the caller.
 */
export default function DocumentActions({ document: doc, capabilities, onDelete, onFavoriteChange, onDownload, onShare, onMove }: DocumentActionsProps) {
  const [open, setOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [copied, setCopied] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${DOCUMENT_PATH(doc.slug)}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    window.setTimeout(() => setCopied(false), 1600);
    setOpen(false);
  };

  const canEdit = capabilities?.canEdit ?? true;
  const canShare = capabilities?.canShare ?? canEdit;

  return (
    <div ref={wrapperRef} className="relative shrink-0" onClick={stop}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((value) => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${doc.title}`}
        className="inline-flex size-11 items-center justify-center rounded-md text-meta transition-colors hover:bg-surface-raised hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${doc.title}`}
          className="absolute right-0 z-30 mt-1 w-44 max-w-[calc(100vw-24px)] rounded-md border border-border bg-surface-overlay p-1 shadow-overlay"
        >
          <Link
            href={DOCUMENT_PATH(doc.slug)}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <PencilLine className="h-4 w-4 text-meta" aria-hidden="true" />
            {canEdit ? "Open and edit" : "Open (view only)"}
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyLink()}
            className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <MorphIcon activeKey={copied ? "copied" : "copy"} variant="blur-scale" className="text-meta">
              {copied ? <span className="text-[11px] font-semibold">✓</span> : <Copy className="h-4 w-4" aria-hidden="true" />}
            </MorphIcon>
            {copied ? "Link copied" : "Copy link"}
          </button>
          {canShare && onShare && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onShare();
              }}
              className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
            >
              <Share2 className="h-4 w-4 text-meta" aria-hidden="true" />
              Share
            </button>
          )}
          {canEdit && onMove && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMove();
              }}
              className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
            >
              <FolderInput className="h-4 w-4 text-meta" aria-hidden="true" />
              Move to workspace
            </button>
          )}
          {onDownload && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onDownload();
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
            >
              <Download className="h-4 w-4 text-meta" aria-hidden="true" />
              Download
            </button>
          )}
          {canEdit && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onFavoriteChange();
            }}
            className="flex w-full items-center gap-2 border-t border-border-subtle px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-surface-raised"
          >
            <MorphIcon activeKey={doc.isFavorite ? "favorite" : "not-favorite"} variant="spring" className={doc.isFavorite ? "text-status-unsaved" : "text-meta"}>
              {doc.isFavorite ? <Star className="h-4 w-4 fill-current" aria-hidden="true" /> : <StarOff className="h-4 w-4" aria-hidden="true" />}
            </MorphIcon>
            {doc.isFavorite ? "Remove favorite" : "Add favorite"}
          </button>
          )}
          {canEdit && (
          <div className="border-t border-border-subtle pt-1" onClick={(event) => event.stopPropagation()}>
            <HoldToConfirm
              label="Hold to delete"
              icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              confirmedLabel="Deleting…"
              tone="danger"
              confirmed={deletePending}
              disabled={deletePending}
              onConfirm={() => {
                setDeletePending(true);
                void onDelete().then(() => {
                  setOpen(false);
                  buttonRef.current?.focus();
                }).catch(() => setDeletePending(false));
              }}
              className={holdStyles.menuItem}
            />
          </div>
          )}
        </div>
      )}
    </div>
  );
}
