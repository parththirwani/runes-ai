import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'link';
type Size = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-150 ease-smooth disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas';

const variants: Record<Variant, string> = {
  primary:
    'bg-action text-white hover:bg-action-hover shadow-paper min-h-[44px] md:min-h-[40px]',
  secondary:
    'bg-surface text-ink border border-line hover:border-line-strong hover:bg-canvas min-h-[44px] md:min-h-[40px]',
  ghost:
    'text-ink-soft hover:text-ink hover:bg-canvas min-h-[44px] md:min-h-[40px]',
  link:
    'text-action hover:text-action-hover underline-offset-4 hover:underline min-h-[44px] md:min-h-[40px] px-0',
};

const sizes: Record<Size, string> = {
  sm: 'text-sm px-3 py-2',
  md: 'text-sm px-5 py-2.5',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', className = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${className}`;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={buttonClass(variant, size, className)}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';

export default Button;
