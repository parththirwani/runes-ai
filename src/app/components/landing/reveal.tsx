"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  distance?: number;
  id?: string;
}

/**
 * Single entrance primitive for the landing page. Motion is deliberately
 * shallow (transform + opacity only) and switches off completely when the
 * visitor asked for reduced motion.
 */
export default function Reveal({
  children,
  className,
  delay = 0,
  distance = 12,
  id,
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-80px" });

  if (reduceMotion) {
    return (
      <div id={id} ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      id={id}
      ref={ref}
      initial={{ opacity: 0, y: distance }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: distance }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
