import { type SVGProps } from 'react';

/**
 * Original icon set for Runes AI.
 * Hand-drawn strokes on a 24x24 grid, 1.75 stroke width,
 * rounded caps. No third-party icon library.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ---- Actions ---- */
export function ArrowRight({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </Svg>
  );
}

export function Check({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Svg>
  );
}

export function Close({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Svg>
  );
}

export function Menu({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M4 8h16" />
      <path d="M4 16h16" />
    </Svg>
  );
}

/* ---- Editing ---- */
export function Pencil({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M4 20l4-1 10-10-3-3L5 16l-1 4z" />
      <path d="M14 6l4 4" />
    </Svg>
  );
}

export function Sparkle({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
    </Svg>
  );
}

export function CursorSelect({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M6 4l5 14 2-6 6-2z" />
    </Svg>
  );
}

/* ---- Document ---- */
export function Document({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </Svg>
  );
}

export function DocWarn({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M6 3h8l4 4v9" />
      <path d="M14 3v4h4" />
      <path d="M18 16v4" />
      <path d="M18 22.5v.01" />
    </Svg>
  );
}

/* ---- Protection / control ---- */
export function Shield({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z" />
      <path d="M9 12l2 2 4-4" />
    </Svg>
  );
}

export function Lock({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </Svg>
  );
}

export function Undo({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M4 9l4-4" />
      <path d="M4 9h9a6 6 0 010 12h-3" />
      <path d="M8 5L4 9" />
    </Svg>
  );
}

/* ---- Format ---- */
export function Hash({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M8 4l-2 16" />
      <path d="M18 4l-2 16" />
      <path d="M4 9h14" />
      <path d="M3 15h14" />
    </Svg>
  );
}

export function Sigma({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M6 5h12l-7 7 7 7H6" />
    </Svg>
  );
}

/* ---- Secondary features ---- */
export function Outline({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M8 6h10" />
      <path d="M8 12h10" />
      <path d="M8 18h10" />
      <path d="M4 6h.01" />
      <path d="M4 12h.01" />
      <path d="M4 18h.01" />
    </Svg>
  );
}

export function Type({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M5 7V5h14v2" />
      <path d="M12 5v14" />
      <path d="M9 19h6" />
    </Svg>
  );
}

export function BookOpen({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z" />
      <path d="M12 6v14" />
    </Svg>
  );
}

export function Download({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M12 4v10" />
      <path d="M8 10l4 4 4-4" />
      <path d="M5 19h14" />
    </Svg>
  );
}

export function ChevronDown({ size = 24, ...props }: IconProps) {
  return (
    <Svg size={size} {...props}>
      <path d="M6 9l6 6 6-6" />
    </Svg>
  );
}
