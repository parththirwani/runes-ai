"use client";

import * as React from "react";
import { motion, type Variants } from "motion/react";
import { cn } from "@/src/lib/utils";

const DEFAULT_PATH = "M1.5 21.4369C26.0507 41.1315 45.4422 49.4684 76.9385 48.0686C105.382 46.8045 136.321 33.2963 162.775 23.4529C195.528 11.2659 259.819 1.74102 278.851 40.5354C293.628 70.6582 271.479 106.679 236.622 96.8755C223.184 93.0961 216.24 75.1565 222.192 62.7107C228.621 49.2681 247.84 42.7879 261.132 39.6866C296.828 31.3576 310.32 59.0906 352.91 70.6684C395.5 82.2461 444.502 59.2461 444.502 4.11208C445.331 1.74673 450.007 11.1118 451.388 13.3211C456.454 21.4205 455.825 16.813 451.995 10.689C449.532 6.75051 446.963 -1.52406 442.455 2.63936C438.202 5.78942 431.802 12.0554 427.5 14.7459";

const strokeVariants: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: { pathLength: 1, opacity: 1, transition: { pathLength: { type: "spring", duration: 2, bounce: 0 }, opacity: { duration: 0.01 } } },
};
const letterVariants: Variants = {
  hidden: { opacity: 0, filter: "blur(8px)", y: 4 },
  visible: (index: number) => ({ opacity: 1, filter: "none", y: 0, transition: { delay: 0.03 * index, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] } }),
};

interface DoodleCalloutProps {
  label: string;
  path?: string;
  viewBox?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
  revealGap?: number;
  loopInterval?: number;
  className?: string;
  labelClassName?: string;
  strokeClassName?: string;
}

export function DoodleCallout({
  label,
  path = DEFAULT_PATH,
  viewBox = "0 0 457 101",
  width = 280,
  height = 62,
  strokeWidth = 5,
  revealGap = 400,
  loopInterval = 8000,
  className,
  labelClassName,
  strokeClassName,
}: DoodleCalloutProps) {
  const [cycle, setCycle] = React.useState(0);
  const [labelVisible, setLabelVisible] = React.useState(false);
  const letters = React.useMemo(() => Array.from(label), [label]);

  React.useEffect(() => {
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (delay: number, callback: () => void) => timers.push(setTimeout(() => !cancelled && callback(), delay));
    const run = () => {
      setLabelVisible(false);
      schedule(revealGap, () => {
        setLabelVisible(true);
        if (loopInterval > 0) schedule(loopInterval, () => { setCycle((value) => value + 1); run(); });
      });
    };
    run();
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, [label, loopInterval, revealGap]);

  return (
    <div className={cn("inline-flex flex-col gap-2", className)}>
      <div className="relative" style={{ width }}>
        <span key={cycle} className={cn("absolute bottom-0 flex translate-x-[-50%] whitespace-nowrap text-lg italic text-action", labelClassName)} style={{ left: "96%" }}>
          {letters.map((character, index) => <motion.span key={index} custom={index} initial="hidden" animate={labelVisible ? "visible" : "hidden"} variants={letterVariants} className="inline-block">{character === " " ? " " : character}</motion.span>)}
        </span>
      </div>
      <motion.svg width={width} height={height} viewBox={viewBox} fill="none" preserveAspectRatio="xMidYMid meet" className={cn("overflow-visible text-action", strokeClassName)}>
        <motion.path key={cycle} d={path} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" fill="none" initial="hidden" animate="visible" variants={strokeVariants} />
      </motion.svg>
    </div>
  );
}
