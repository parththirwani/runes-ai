import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";
import { prisma } from "./db";

export function withAuth(
  handler: (req: NextRequest, session: any, context: any) => Promise<Response>
) {
  return async (req: NextRequest, context: any) => {
    let session = await auth();

    // Dev-mode bypass: check for dev-session cookie
    if (!session?.user?.id && process.env.NODE_ENV === "development") {
      const devCookie = req.cookies.get("dev-session")?.value || req.cookies.get("dev-session-readable")?.value;
      if (devCookie) {
        try {
          const payload = JSON.parse(Buffer.from(devCookie, "base64url").toString());
          if (payload.id) {
            const dbUser = await prisma.user.findUnique({ where: { id: payload.id } });
            if (dbUser) {
              session = {
                user: {
                  id: dbUser.id,
                  email: dbUser.email,
                  name: `${dbUser.firstName || ""} ${dbUser.lastName || ""}`.trim(),
                },
                expires: new Date(Date.now() + 86400000).toISOString(),
              } as any;
            }
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