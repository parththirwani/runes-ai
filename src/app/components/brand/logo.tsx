import Image from "next/image";
import { cn } from "@/src/lib/utils";

/**
 * Shared logo. Both assets are tightly cropped derivatives of the original
 * artwork (public/logo.png and public/small-logo.png), so the drawing is
 * unchanged while the intrinsic ratio now matches what the header asks for.
 *
 *  wordmark  rune mark + RUNES AI lettering, 367x73  -> header / nav
 *  mark      rune mark only, 179x179                 -> compact contexts
 */
const ASSETS = {
  wordmark: { src: "/logo-wordmark.png", width: 367, height: 73, alt: "Runes AI" },
  mark: { src: "/logo-mark.png", width: 179, height: 179, alt: "Runes AI rune mark" },
} as const;

const HEIGHTS = {
  sm: "h-6",
  md: "h-7",
  lg: "h-9",
  xl: "h-14",
} as const;

export type LogoVariant = keyof typeof ASSETS;
export type LogoSize = keyof typeof HEIGHTS;

interface LogoProps {
  variant?: LogoVariant;
  size?: LogoSize;
  className?: string;
  /** Override the accessible name, e.g. when the link text already says it. */
  alt?: string;
  decorative?: boolean;
}

export default function Logo({
  variant = "wordmark",
  size = "md",
  className,
  alt,
  decorative = false,
}: LogoProps) {
  const asset = ASSETS[variant];

  return (
    <Image
      src={asset.src}
      alt={decorative ? "" : (alt ?? asset.alt)}
      width={asset.width}
      height={asset.height}
      priority
      className={cn("w-auto object-contain", HEIGHTS[size], className)}
    />
  );
}
