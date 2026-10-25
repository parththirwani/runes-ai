"use client";

import * as React from "react";
import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/src/lib/utils";

export type MorphIconVariant = "blur-scale" | "rotate-scale" | "flip" | "spring";

interface MorphIconProps extends Omit<HTMLMotionProps<"span">, "children"> {
  activeKey: React.Key;
  children: React.ReactNode;
  variant?: MorphIconVariant;
  duration?: number;
}

const variants = {
  "blur-scale": {
    initial: { scale: 0.2, opacity: 0, filter: "blur(4px)", rotate: -15 },
    animate: { scale: 1, opacity: 1, filter: "blur(0px)", rotate: 0 },
    exit: { scale: 0.2, opacity: 0, filter: "blur(4px)", rotate: 15 },
  },
  "rotate-scale": { initial: { scale: 0, opacity: 0, rotate: -90 }, animate: { scale: 1, opacity: 1, rotate: 0 }, exit: { scale: 0, opacity: 0, rotate: 90 } },
  flip: { initial: { rotateY: 90, opacity: 0 }, animate: { rotateY: 0, opacity: 1 }, exit: { rotateY: -90, opacity: 0 } },
  spring: { initial: { scale: 0.3, y: 4, opacity: 0 }, animate: { scale: 1, y: 0, opacity: 1 }, exit: { scale: 0.3, y: -4, opacity: 0 } },
} satisfies Record<MorphIconVariant, { initial: HTMLMotionProps<"span">["initial"]; animate: HTMLMotionProps<"span">["animate"]; exit: HTMLMotionProps<"span">["exit"] }>;

export function MorphIcon({ activeKey, children, className, variant = "blur-scale", duration = 0.22, ...props }: MorphIconProps) {
  const selected = variants[variant];
  return <AnimatePresence mode="popLayout" initial={false}><motion.span key={activeKey} data-slot="morph-icon" className={cn("pointer-events-none inline-flex shrink-0 items-center justify-center", className)} initial={selected.initial} animate={selected.animate} exit={selected.exit} transition={{ duration, ease: [0.16, 1, 0.3, 1] }} {...props}>{children}</motion.span></AnimatePresence>;
}
