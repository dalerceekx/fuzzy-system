import type { ComponentProps, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/shared/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  // Dark text on straw (5.9:1, 4.9:1 on hover). White text on straw is never used.
  primary: 'bg-primary text-ink hover:bg-primary-hover border border-primary-hover/60',
  secondary: 'bg-card text-ink border border-line hover:bg-background hover:border-input-line',
  ghost: 'bg-transparent text-ink-secondary border border-transparent hover:bg-neutral-light hover:text-ink',
  danger: 'bg-danger text-white border border-danger hover:bg-[#8e332f]',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-[15px] gap-2',
  lg: 'min-h-12 px-5 text-base gap-2',
};

export function buttonClasses({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string | undefined;
}): string {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-[10px] font-medium transition-colors',
    'disabled:opacity-60 aria-disabled:opacity-60',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
    className,
  );
}

interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and prevents double submits. */
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant,
  size,
  loading = false,
  icon,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner className="size-4" /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function ButtonLink({ variant, size, icon, fullWidth, className, children, ...props }: ButtonLinkProps) {
  return (
    <Link
      className={buttonClasses({ variant, size, fullWidth, className: typeof className === 'string' ? className : undefined })}
      {...props}
    >
      {icon}
      {children}
    </Link>
  );
}

interface IconButtonProps extends ComponentProps<'button'> {
  /** Required: icon-only buttons need an accessible name. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
}

export function IconButton({ label, icon, variant = 'ghost', className, type = 'button', ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] transition-colors disabled:opacity-60',
        VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
}
