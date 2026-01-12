import { NextRequest, NextResponse } from "next/server";
import { auth } from "./auth";

export function withAuth(
  handler: (req: NextRequest, session: any, context: any) => Promise<Response>
) {
  return async (req: NextRequest, context: any) => {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json(
        { message: "Unauthorized" },
        { status: 401 }
      );
    }

    return handler(req, session, context);
  };
}