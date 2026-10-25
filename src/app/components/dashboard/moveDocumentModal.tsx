"use client";

import { useEffect, useState } from "react";
import Modal from "../design/Modal";
import Button from "../design/Button";
import type { LibraryWorkspace, MovePreview } from "@/src/types/library";

interface MoveDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  document: { id: string; title: string; workspaceId?: string | null } | null;
  workspaces: LibraryWorkspace[];
  onMove: (workspaceId: string) => Promise<void>;
  onPreview: (workspaceId: string) => Promise<MovePreview | undefined>;
}

/**
 * Moves a document the actor authored into another collection they may create in. The preview
 * from the server states what changes about who can see it — team members gain view access,
 * a previous team stops seeing it, direct shares survive — and is shown before anything is sent.
 */
export default function MoveDocumentModal({ isOpen, onClose, document: doc, workspaces, onMove, onPreview }: MoveDocumentModalProps) {
  const targets = workspaces.filter((workspace) => workspace.capabilities.canCreate && workspace.id !== doc?.workspaceId);
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTargetId("");
      setPreview(null);
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    setPreview(null);
    if (!isOpen || !doc || !targetId) return undefined;
    void onPreview(targetId).then((value) => {
      if (active) setPreview(value ?? null);
    });
    return () => {
      active = false;
    };
  }, [isOpen, doc, targetId, onPreview]);

  const confirm = async () => {
    if (!targetId) return;
    setBusy(true);
    try {
      await onMove(targetId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not move the document");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={doc ? `Move “${doc.title}”` : "Move document"}
      description="Only the document's author can move it. Readers of the destination see it from then on; readers of the old collection stop seeing it."
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void confirm()} loading={busy} disabled={!targetId || Boolean(preview?.collision)}>Move document</Button>
        </div>
      }
    >
      <label htmlFor="move-target" className="mb-1 block text-xs font-medium text-muted-foreground">Move to workspace</label>
      <select
        id="move-target"
        value={targetId}
        onChange={(event) => setTargetId(event.target.value)}
        className="h-10 w-full rounded border border-input bg-surface px-3 text-sm text-foreground focus:border-action focus:outline-none focus-visible:ring-2 focus-visible:ring-action/25"
      >
        <option value="">Choose a workspace…</option>
        {targets.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.kind === "TEAM" ? `${workspace.name} (team)` : workspace.name}
          </option>
        ))}
      </select>

      {targets.length === 0 && <p className="mt-2 text-sm text-meta">You have no other workspace to move this into yet.</p>}

      {preview && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground" aria-live="polite">
          {preview.grantsTeamAccess && <li>Everyone in the destination team will be able to open it.</li>}
          {preview.removesTeamAccess && <li>The team that currently sees it will stop seeing it.</li>}
          {preview.keepsDirectShares && <li>People you shared this document with keep their access.</li>}
          {preview.collision && <li className="text-destructive">A document named “{preview.collision}” already exists there. Rename this one first.</li>}
        </ul>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    </Modal>
  );
}
