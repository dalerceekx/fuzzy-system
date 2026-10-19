import { useQuery } from '@tanstack/react-query';
import { MessageSquareText, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { formatDateTime } from '@/shared/lib/format';
import { Button, ErrorState } from '@/shared/ui';
import { http } from '@/shared/api/client';
import type { DevSmsMessage } from '../api/auth.types';

async function fetchInbox(): Promise<DevSmsMessage[]> {
  const { data } = await http.get<DevSmsMessage[] | { items: DevSmsMessage[] }>('/dev/sms-inbox', { skipAuth: true });
  return Array.isArray(data) ? data : data.items;
}

/**
 * DEVELOPMENT ONLY (lazy-loaded behind `import.meta.env.DEV`): reads the
 * backend's mock SMS inbox (GET /dev/sms-inbox, present only when the API
 * runs with SMS_PROVIDER=mock) so OTP flows can be tested locally.
 */
export default function DevSmsInbox() {
  const [open, setOpen] = useState(false);
  const inbox = useQuery({ queryKey: ['dev', 'sms-inbox'], queryFn: fetchInbox, enabled: open, retry: false });

  return (
    <section className="rounded-[12px] border border-dashed border-input-line bg-background px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <MessageSquareText aria-hidden className="size-4 text-warning" />
          Dev SMS inbox
        </p>
        {open ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw aria-hidden className="size-4" />}
            onClick={() => void inbox.refetch()}
          >
            Yangilash
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
            Ko‘rsatish
          </Button>
        )}
      </div>
      {open ? (
        inbox.isError ? (
          <ErrorState error={inbox.error} collection className="py-4" />
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {(inbox.data ?? []).slice(0, 5).map((message, index) => (
              <li key={`${message.sentAt}-${index}`} className="rounded-[8px] bg-card px-3 py-2">
                <p className="text-ink">{message.text}</p>
                <p className="mt-0.5 text-[12px] text-ink-secondary">
                  {message.to} · {formatDateTime(message.sentAt)}
                </p>
              </li>
            ))}
            {inbox.data?.length === 0 ? <li className="text-ink-secondary">Xabarlar yo‘q</li> : null}
          </ul>
        )
      ) : null}
    </section>
  );
}
