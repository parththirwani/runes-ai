import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Dev-mode auth middleware: when a valid dev-session cookie is present,
// rewrite the session response to include the dev user.
// This makes useSession() work on the client for dev/document pages.
export async function middleware(req: NextRequest) {
  // Only intercept session API calls in development
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.next();
  }

  const url = req.nextUrl.pathname;

  // Intercept NextAuth session endpoint
  if (url === "/api/auth/session") {
    const devCookie =
      req.cookies.get("dev-session")?.value ||
      req.cookies.get("dev-session-readable")?.value;

    if (devCookie) {
      try {
        const payload = JSON.parse(
          Buffer.from(devCookie, "base64url").toString()
        );
        if (payload.id) {
          // Return a fake session response
          return NextResponse.json({
            user: {
              id: payload.id,
              email: payload.email,
              name: payload.name,
              image: payload.picture || null,
            },
            expires: new Date(Date.now() + 86400000).toISOString(),
          });
        }
      } catch {
        // Invalid cookie — pass through
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/session"],
};