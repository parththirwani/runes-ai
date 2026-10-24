'use client';

import { signOut, useSession } from 'next-auth/react';
import { LogOut } from 'lucide-react';

interface SignOutButtonProps {
  className?: string;
}

export default function SignOutButton({ className = '' }: SignOutButtonProps) {
  const { status } = useSession();
  if (status !== 'authenticated') return null;

  return (
    <button
      type="button"
      onClick={() => void signOut({ redirectTo: '/' })}
      aria-label="Sign out"
      title="Sign out"
      className={`inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 max-[360px]:px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-raised hover:text-foreground ${className}`}
    >
      <LogOut className="h-4 w-4" aria-hidden="true" />
      <span className="max-[360px]:sr-only">Sign out</span>
    </button>
  );
}
