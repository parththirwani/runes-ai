import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  /** Accessible name. Icon-only buttons must always describe themselves. */
  label: string;
  variant?: 'default' | 'ghost' | 'active';
  size?: 'sm' | 'md' | 'lg';
  tooltip?: string;
}

const baseStyles =
  'inline-flex items-center justify-center rounded-md transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-[1px] [@media(pointer:coarse)]:size-11';

const variants = {
  default: 'bg-surface-raised text-muted-foreground border border-border hover:text-foreground hover:bg-surface-overlay',
  ghost: 'text-meta hover:bg-surface-raised hover:text-foreground',
  active: 'bg-primary text-primary-foreground hover:bg-primary-hover'
};

const sizes = {
  sm: 'size-7',
  md: 'size-9',
  lg: 'size-11'
};

export default function IconButton({
  icon,
  label,
  variant = 'default',
  size = 'md',
  tooltip,
  className = '',
  onClick,
  disabled,
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={tooltip ?? label}
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {icon}
    </button>
  );
}
