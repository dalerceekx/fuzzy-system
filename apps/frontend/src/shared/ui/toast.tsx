import { CircleAlert, CircleCheck, X } from 'lucide-react';
import { useEffect } from 'react';
import { create } from 'zustand';
import { cn } from '@/shared/lib/cn';

type ToastTone = 'success' | 'error';

interface ToastMessage {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastState {
  toasts: ToastMessage[];
  push: (tone: ToastTone, message: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;
const MAX_VISIBLE = 4;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => set((state) => ({ toasts: [...state.toasts, { id: nextId++, tone, message }].slice(-MAX_VISIBLE) })),
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

/** Success/error feedback after mutations. */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
};

const DURATION: Record<ToastTone, number> = { success: 4_000, error: 8_000 };

function ToastItem({ toast: item }: { toast: ToastMessage }) {
  const dismiss = useToastStore((state) => state.dismiss);
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), DURATION[item.tone]);
    return () => window.clearTimeout(timer);
  }, [dismiss, item.id, item.tone]);

  const isError = item.tone === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'pointer-events-auto flex w-full items-start gap-3 rounded-[12px] border bg-card px-4 py-3 text-sm text-ink shadow-[0_8px_24px_rgba(45,41,31,0.10)]',
        isError ? 'border-danger/40' : 'border-success/40',
      )}
    >
      {isError ? (
        <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-danger" />
      ) : (
        <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
      )}
      <p className="flex-1">{item.message}</p>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="Xabarni yopish"
        className="-mt-1 -mr-2 inline-flex size-8 items-center justify-center rounded-[8px] text-ink-secondary hover:bg-neutral-light"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-[calc(96px+env(safe-area-inset-bottom))] z-[60] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-6 sm:w-96"
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </div>
  );
}
