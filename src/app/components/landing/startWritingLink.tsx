"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { startWritingPath, type AuthStatus } from "@/src/lib/paths";

/**
 * Primary signup intent. Guests are sent to sign-in, signed-in users go
 * straight to their documents, so the label can never point at a dead route.
 */
export default function StartWritingLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { status } = useSession();
  return (
    <Link href={startWritingPath(status as AuthStatus)} className={className}>
      {children}
    </Link>
  );
}
