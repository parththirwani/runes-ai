import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { prisma } from "./db";
import { verifyDevSession } from './dev-session';
import type { Session } from 'next-auth';

type RouteContext = { params: Promise<Record<string, string>> };

export function withAuth(
  handler: (req: NextRequest, session: Session, context: RouteContext) => Promise<Response>
) {
  return async (req: NextRequest, context: RouteContext) => {
    let session = await auth();

    // Dev-mode bypass: check for dev-session cookie
    if (!session?.user?.id && process.env.NODE_ENV === "development") {
      const payload = await verifyDevSession(req.cookies.get('dev-session')?.value);
      if (payload) {
        try {
          const dbUser = await prisma.user.findUnique({ where: { id: payload.id } });
          if (dbUser) {
            session = {
              user: {
                id: dbUser.id,
                email: dbUser.email,
                name: `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim(),
              },
              expires: new Date(Date.now() + 86400000).toISOString(),
            };
          }
        } catch {
          // Invalid cookie — ignore
        }
      }
    }

    if (!session?.user?.id) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    return handler(req, session, context);
  };
}
