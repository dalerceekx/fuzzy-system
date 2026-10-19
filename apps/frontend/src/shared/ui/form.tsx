import { ChevronDown, Eye, EyeOff } from 'lucide-react';
import { cloneElement, isValidElement, useId, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

const CONTROL =
  'w-full rounded-[10px] border border-input-line bg-input px-3 text-[15px] text-ink transition-colors ' +
  'hover:border-ink-secondary focus:border-focus focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ' +
  'aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-neutral-light disabled:text-ink-secondary';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL, 'min-h-11', className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<'textarea'>) {
  return <textarea rows={rows} className={cn(CONTROL, 'py-2.5 leading-relaxed', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select className={cn(CONTROL, 'min-h-11 appearance-none pr-10', className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-secondary"
      />
    </div>
  );
}

interface PasswordInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  showLabel?: string;
  hideLabel?: string;
}

export function PasswordInput({
  className,
  showLabel = 'Parolni ko‘rsatish',
  hideLabel = 'Parolni yashirish',
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pr-12', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        className="absolute top-1/2 right-1 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-neutral-light hover:text-ink"
      >
        {visible ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}

interface FieldProps {
  label: ReactNode;
  /** Explicit id; generated when omitted. */
  id?: string;
  hint?: ReactNode;
  error?: string | undefined;
  required?: boolean;
  className?: string;
  /** A single form control; it receives id/aria-invalid/aria-describedby. */
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string; required?: boolean }>;
}

/**
 * Label + control + hint + error, wired for screen readers. Errors are
 * announced through aria-describedby and shown in danger color with text
 * (never color alone).
 */
export function Field({ label, id, hint, error, required, className, children }: FieldProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
        required: required || undefined,
      })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {control}
      {hint ? (
        <p id={hintId} className="text-[13px] text-ink-secondary">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-light px-3 py-2.5 text-sm text-danger">
      {message}
    </div>
  );
}

export function Checkbox({ label, className, ...props }: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }) {
  const id = useId();
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <input
        id={props.id ?? id}
        type="checkbox"
        className="size-5 rounded border-input-line accent-[var(--primary-hover)]"
        {...props}
      />
      <label htmlFor={props.id ?? id} className="text-sm text-ink">
        {label}
      </label>
    </div>
  );
}
