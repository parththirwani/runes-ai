import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  variant?: 'default' | 'ghost' | 'active';
  size?: 'sm' | 'md' | 'lg';
  tooltip?: string;
}

export default function IconButton({
  icon,
  variant = 'default',
  size = 'md',
  tooltip,
  className = '',
  onClick,
  disabled,
  ...props
}: IconButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variants = {
    default: 'bg-[#3e3e3e] text-gray-300 hover:bg-[#4e4e4e] hover:text-white',
    ghost: 'bg-transparent text-gray-400 hover:bg-[#3e3e3e] hover:text-white',
    active: 'bg-emerald-600 text-white hover:bg-emerald-700'
  };
  
  const sizes = {
    sm: 'p-1.5 text-sm',
    md: 'p-2 text-base',
    lg: 'p-3 text-lg'
  };

  return (
    <button
      className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
      title={tooltip}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {icon}
    </button>
  );
}