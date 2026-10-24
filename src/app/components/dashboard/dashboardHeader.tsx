import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import Logo from "../brand/logo";
import { Button } from "../ui/button";
import { DOCUMENTS_PATH } from "@/src/lib/paths";

interface DashboardHeaderProps {
  onCreateDocument: () => void;
}

export default function DashboardHeader({ onCreateDocument }: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-surface/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-content items-center justify-between gap-4 px-6 lg:px-8">
        <Link href={DOCUMENTS_PATH} className="flex shrink-0 items-center" aria-label="Runes AI documents">
          <Logo variant="wordmark" size="sm" className="hidden sm:block" />
          <Logo variant="mark" size="sm" className="sm:hidden" alt="Runes AI" />
        </Link>

        <Button size="sm" className="min-h-11" onClick={onCreateDocument}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          New document
        </Button>
      </div>
    </header>
  );
}
