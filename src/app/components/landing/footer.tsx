import Link from "next/link";
import Logo from "../brand/logo";
import { FEATURES_ANCHOR, HOW_IT_WORKS_ANCHOR, SIGN_IN_PATH, DOCUMENTS_PATH } from "@/src/lib/paths";

const LINKS = [
  { label: "Features", href: FEATURES_ANCHOR },
  { label: "How it works", href: HOW_IT_WORKS_ANCHOR },
  { label: "Sign in", href: SIGN_IN_PATH },
  { label: "Documents", href: DOCUMENTS_PATH },
];

export default function Footer() {
  return (
    <footer className="overflow-hidden border-t border-border-subtle bg-surface">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <Link href="/" className="flex w-fit items-center" aria-label="Runes AI home">
            <Logo variant="wordmark" size="md" />
          </Link>

          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-8 gap-y-3">
              {LINKS.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border-subtle pt-6 text-xs text-meta sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Runes AI</p>
          <p>LaTeX editor, AI prose review, PDF output.</p>
        </div>
      </div>

      <div aria-hidden="true" className="select-none px-2 pb-2">
        <p className="whitespace-nowrap text-center text-[clamp(3rem,15vw,11rem)] font-semibold leading-[0.9] tracking-tighter text-foreground/8">
          Runes AI
        </p>
      </div>
    </footer>
  );
}
