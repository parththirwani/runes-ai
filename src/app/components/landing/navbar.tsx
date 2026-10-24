"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import Logo from "../brand/logo";
import SignOutButton from "../auth/SignOutButton";
import StartWritingLink from "./startWritingLink";
import { Button } from "../ui/button";
import { SIGN_IN_PATH, FEATURES_ANCHOR, HOW_IT_WORKS_ANCHOR } from "@/src/lib/paths";

const NAV_ITEMS = [
  { label: "Features", href: FEATURES_ANCHOR },
  { label: "How it works", href: HOW_IT_WORKS_ANCHOR },
];

export default function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const { status } = useSession();
  const reduceMotion = useReducedMotion();

  const scrollToSection = (event: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    const [, anchor] = href.split("#");
    const target = document.getElementById(anchor);
    if (target) {
      event.preventDefault();
      target.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
    }
    setIsOpen(false);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-border-subtle bg-background/85 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-6 px-5 lg:px-8">
        <Link
          href="/"
          className="flex shrink-0 items-center"
          aria-label="Runes AI home"
        >
          <Logo variant="wordmark" size="sm" />
        </Link>

        <ul className="hidden items-center gap-7 md:flex">
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={(event) => scrollToSection(event, item.href)}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="hidden items-center gap-2 md:flex">
          {status === 'authenticated' ? (
            <SignOutButton />
          ) : (
            <Link href={SIGN_IN_PATH}>
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                Sign in
              </Button>
            </Link>
          )}
          <StartWritingLink>
            <Button size="sm">Start writing</Button>
          </StartWritingLink>
        </div>

        <button
          type="button"
          className="inline-flex size-10 items-center justify-center rounded-md text-foreground transition-colors hover:bg-surface-raised md:hidden"
          aria-expanded={isOpen}
          aria-controls="mobile-nav"
          onClick={() => setIsOpen((open) => !open)}
        >
          {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          <span className="sr-only">{isOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </nav>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="border-t border-border-subtle bg-surface md:hidden"
          >
            <ul className="mx-auto flex w-full max-w-6xl flex-col px-5 py-3">
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={(event) => scrollToSection(event, item.href)}
                    className="block py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
              <li className="flex flex-col gap-2 border-t border-border-subtle py-4">
                <StartWritingLink>
                  <Button className="w-full">Start writing</Button>
                </StartWritingLink>
                {status === 'authenticated' ? (
                  <SignOutButton className="w-full border border-border bg-surface text-foreground" />
                ) : (
                  <Link href={SIGN_IN_PATH}>
                    <Button variant="outline" className="w-full">
                      Sign in
                    </Button>
                  </Link>
                )}
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
