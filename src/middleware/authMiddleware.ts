import { auth } from "@/src/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  // public routes
  if (pathname.startsWith("/signin")) {
    return NextResponse.next();
  }

  // protect everything else
  if (!isLoggedIn) {
    return NextResponse.redirect(
      new URL("/signin", req.nextUrl)
    );
  }
});

export const config = {
  matcher: [
    "/((?!api/auth|_next|favicon.ico).*)",
  ],
};
