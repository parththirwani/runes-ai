import { NextRequest, NextResponse } from "next/server";
import type { Session } from 'next-auth';
import { resolveSession } from "./session";

type RouteContext = { params: Promise<Record<string, string>> };

export function withAuth<C extends { params: Promise<Record<string, string | string[]>> } = RouteContext>(
  handler: (req: NextRequest, session: Session, context: C) => Promise<Response>
) {
  return async (req: NextRequest, context: C) => {
    // Same resolver the server rendered pages use, so a page never believes a caller is
    // someone the API behind it disagrees with.
    const session = await resolveSession();

    if (!session?.user?.id) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    return handler(req, session, context);
  };
}
