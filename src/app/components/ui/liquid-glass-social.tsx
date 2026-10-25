"use client";

import { motion } from "motion/react";
import { Github, Linkedin, Twitter } from "lucide-react";
import { useState, type ComponentType } from "react";
import { cn } from "@/src/lib/utils";

export interface SocialLink {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

interface LiquidGlassSocialProps {
  links: SocialLink[];
  className?: string;
}

export function LiquidGlassSocial({ links, className }: LiquidGlassSocialProps) {
  const [activeTab, setActiveTab] = useState("");

  return (
    <motion.div className={cn("flex items-center gap-1.5", className)} onMouseLeave={() => setActiveTab("")}>
      {links.map(({ name, href, icon: Icon }) => {
        const active = activeTab === name;
        return (
          <motion.a
            key={name}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={name}
            onMouseEnter={() => setActiveTab(name)}
            onFocus={() => setActiveTab(name)}
            className="relative rounded-lg p-2 text-ink-muted transition-colors hover:text-ink focus-visible:text-ink"
          >
            {active && (
              <motion.span
                layoutId="runes-liquid-glass-social"
                className="absolute inset-0 rounded-lg border border-line-strong bg-surface shadow-[inset_0_1px_0_rgb(255_255_255/.9),0_5px_14px_rgb(23_32_27/.08)]"
              />
            )}
            <Icon className="relative z-10 size-4" aria-hidden="true" />
          </motion.a>
        );
      })}
    </motion.div>
  );
}

export const RunesSocialLinks: SocialLink[] = [
  {
    name: "Parth Thirwani on X",
    href: "https://x.com/Parth_Thirwani",
    icon: Twitter,
  },
  {
    name: "Parth Thirwani on LinkedIn",
    href: "https://www.linkedin.com/in/parth-thirwani-887b26217/",
    icon: Linkedin,
  },
  {
    name: "Runes AI on GitHub",
    href: "https://github.com/parththirwani/runes-ai",
    icon: Github,
  },
];
