import { Sprout } from 'lucide-react';
import { cn } from '@/shared/lib/cn';

/** "MeningFermam" logo: sprout on a straw tile + wordmark. */
export function BrandMark({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <span
        aria-hidden
        className={cn(
          'inline-flex items-center justify-center rounded-[10px] bg-primary text-ink',
          size === 'lg' ? 'size-11' : 'size-9',
        )}
      >
        <Sprout className={size === 'lg' ? 'size-6' : 'size-5'} strokeWidth={2.2} />
      </span>
      <span className={cn('font-bold tracking-tight text-ink', size === 'lg' ? 'text-2xl' : 'text-lg')}>
        Mening<span className="text-warning">Fermam</span>
      </span>
    </span>
  );
}
