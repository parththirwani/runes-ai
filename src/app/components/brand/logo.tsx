import Image from "next/image";
import { cn } from "@/src/lib/utils";

const LOGO_SRC = "/brand-logo.png";

const HEIGHTS = {
  sm: "h-6",
  md: "h-7",
  lg: "h-9",
  xl: "h-14",
} as const;

export type LogoVariant = "wordmark" | "mark";
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
  const image = (
    <Image
      src={LOGO_SRC}
      alt={variant === "mark" && !decorative ? (alt ?? "Runes AI") : ""}
      width={701}
      height={698}
      priority
      className={cn("aspect-square w-auto shrink-0 object-contain", HEIGHTS[size])}
    />
  );

  if (variant === "mark") {
    return <span className={cn("inline-flex shrink-0 items-center", className)}>{image}</span>;
  }

  return (
    <span className={cn("inline-flex shrink-0 items-center gap-2 whitespace-nowrap", className)}>
      {image}
      <span aria-hidden={decorative || undefined} className="text-[1rem] font-semibold tracking-tight text-current">
        Runes AI
      </span>
    </span>
  );
}
