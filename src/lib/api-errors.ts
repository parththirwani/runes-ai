// Shared HTTP error mapping for the workspace, sharing, team and admin routes.
//
// The rule the routes must keep: an authorization failure and a missing row produce the same
// answer. Confirming that a document exists but is forbidden would leak titles, ids and slug
// patterns to anyone willing to iterate.

import { NextResponse } from 'next/server';
import { WorkspaceInputError } from './workspaces';
import { SharingError } from './sharing';
import { TeamError } from './teams';
import { InvitationError } from './invitations';
import { AdminError } from './admin';
import { WorkspaceError, WorkspacePathError } from './workspace-files';

export function apiError(error: unknown, fallback = 'Internal server error'): NextResponse {
  if (error instanceof WorkspaceInputError || error instanceof SharingError || error instanceof TeamError || error instanceof InvitationError || error instanceof AdminError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof WorkspaceError || error instanceof WorkspacePathError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // A transaction that aborted because of a concurrent writer is retryable, not fatal.
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2034') {
    return NextResponse.json({ error: 'A concurrent change conflicted with this request. Please retry.' }, { status: 409 });
  }
  console.error('[API_ERROR]', error instanceof Error ? error.message : 'unknown');
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export function notFound(message = 'Not found'): NextResponse {
  return NextResponse.json({ error: message }, { status: 404 });
}

export async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await req.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
