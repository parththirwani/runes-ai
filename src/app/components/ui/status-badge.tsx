"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/src/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-xl font-semibold transition-colors", {
  variants: {
    variant: {
      default: "border-transparent bg-muted text-foreground",
      inverted: "border-transparent bg-foreground text-background",
      outline: "border border-border bg-transparent text-foreground",
    },
    size: {
      xs: "gap-1.5 px-1.5 py-0.5 text-[10px]",
      sm: "gap-1.5 px-1.5 py-1 text-xs",
      default: "gap-1.5 px-2 py-1.5 text-xs",
      md: "gap-2 px-2 py-1.5 text-sm",
      lg: "gap-2 px-2.5 py-2 text-base",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

const indicatorVariants = cva("inline-flex shrink-0 rounded-full", {
  variants: {
    status: {
      online: "bg-green-500",
      offline: "bg-gray-400",
      busy: "bg-red-500",
      away: "bg-yellow-500",
      available: "bg-green-500",
      error: "bg-red-600",
      warning: "bg-orange-500",
      info: "bg-blue-500",
    },
    size: {
      xs: "size-1.5",
      sm: "size-2",
      default: "size-2",
      md: "size-2.5",
      lg: "size-3",
    },
  },
  defaultVariants: { status: "online", size: "default" },
});

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  status?: "online" | "offline" | "busy" | "away" | "available" | "error" | "warning" | "info";
  primaryText?: string;
  animated?: boolean;
  showIndicator?: boolean;
}

export function StatusBadge({
  className,
  variant,
  size,
  status = "online",
  primaryText,
  animated = true,
  showIndicator = true,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props}>
      {showIndicator && (
        <span className="relative flex size-fit" aria-hidden="true">
          {animated && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60", status === "available" || status === "online" ? "bg-green-300" : "bg-gray-300")} />}
          <span className={indicatorVariants({ status, size })} />
        </span>
      )}
      {primaryText && <span>{primaryText}</span>}
      {children && <span className="font-normal opacity-70">{children}</span>}
    </div>
  );
}
