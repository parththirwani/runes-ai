import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { resolveRequestSession } from "./session";

type RouteContext = { params: Promise<Record<string, string>> };

export function withAuth<C extends { params: Promise<Record<string, string | string[]>> } = RouteContext>(
  handler: (req: NextRequest, session: Session, context: C) => Promise<Response>
) {
  return async (req: NextRequest, context: C) => {
    // Same acceptance rule the server pages use: a user id, and a development
    // identity that still exists in the database.
    const session = await resolveRequestSession(req.cookies.get("dev-session")?.value);

    if (!session?.user?.id) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    return handler(req, session, context);
  };
}
