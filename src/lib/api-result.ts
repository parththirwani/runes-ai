// Shared response helpers for the workspace, sharing, team, and admin routes.
//
// Two rules the checklist depends on: a capability failure keeps the non-revealing status the
// access service chose (usually 404), and an unexpected failure never leaks its message.

import { NextResponse } from "next/server";
import { AccessError, accessErrorResponse } from "./access";

export function invalidInput(error: { issues: readonly { path: readonly unknown[]; message: string }[] }) {
  return NextResponse.json(
    {
      error: "Invalid input",
      details: error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message })),
    },
    { status: 400 },
  );
}

export function serverError(label: string, error?: unknown): NextResponse {
  // Log a label only. Request payloads here can carry email addresses and document content.
  console.error("[" + label + "]", error instanceof Error ? error.constructor.name : "unknown");
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

/** Turns a thrown access error into its response, or returns null when it is not one. */
export function fromAccessError(error: unknown): NextResponse | null {
  if (error instanceof AccessError) {
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  return accessErrorResponse(error);
}

/** Wraps a handler body so every route reports access failures the same way. */
export async function routeResult(label: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    const handled = fromAccessError(error);
    if (handled) return handled;
    return serverError(label, error);
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
