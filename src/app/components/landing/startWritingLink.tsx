"use client";

import Link from "next/link";
import { startWritingPath } from "@/src/lib/paths";

/**
 * Primary writing intent. Everyone can choose a source format before
 * continuing to the document workspace.
 */
export default function StartWritingLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link href={startWritingPath()} className={className}>
      {children}
    </Link>
  );
}
