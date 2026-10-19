import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, ScrollText } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ROLE_LABELS } from '@/features/auth/lib/permissions';
import { auditApi, type AuditListQuery, type AuditLog } from '@/features/audit/api/audit.api';
import { AUDIT_ACTION_LABELS, AUDIT_RESOURCE_LABELS, auditActionLabel } from '@/features/audit/lib/actions';
import { DateRangeFilter } from '@/features/expenses/components/DateRangeFilter';
import { type DateRange } from '@/features/inventory/lib/ledger';
import { useAllUsers } from '@/features/users/model/users.queries';
import { addDays, todayInTashkent } from '@/shared/lib/dates';
import { formatDateTime } from '@/shared/lib/format';
import { DEFAULT_PAGE_SIZE } from '@/shared/types/api';
import {
  AsyncContent,
  Button,
  Card,
  DataTable,
  EmptyState,
  Field,
  IconButton,
  Input,
  Modal,
  Pagination,
  Select,
  type Column,
} from '@/shared/ui';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Tashkent calendar day → UTC ISO bounds (UTC+5, no DST). */
function dayBounds(range: DateRange): { from: string; to: string } {
  return {
    from: new Date(`${range.from}T00:00:00+05:00`).toISOString(),
    to: new Date(`${range.to}T23:59:59.999+05:00`).toISOString(),
  };
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[13px] text-ink-secondary">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-[10px] border border-line bg-background p-3 text-[13px] leading-relaxed whitespace-pre-wrap text-ink">
        {value === null || value === undefined ? '—' : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditLogsPage() {
  const today = todayInTashkent();
  const [range, setRange] = useState<DateRange>({ from: addDays(today, -30), to: today });
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [actorInput, setActorInput] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const users = useAllUsers();
  const names = useMemo(() => new Map((users.data?.items ?? []).map((user) => [user.id, user.fullName])), [users.data]);

  const actorId = UUID.test(actorInput.trim()) ? actorInput.trim() : undefined;
  const query: AuditListQuery = {
    page,
    limit: DEFAULT_PAGE_SIZE,
    ...dayBounds(range),
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(actorId ? { actorId } : {}),
  };
  const logs = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: () => auditApi.list(query),
    placeholderData: keepPreviousData,
  });

  const columns: Column<AuditLog>[] = [
    { key: 'time', header: 'Vaqt', cell: (log) => formatDateTime(log.timestamp) },
    {
      key: 'actor',
      header: 'Bajaruvchi',
      cell: (log) =>
        log.actorId ? (
          <span className="flex flex-col">
            <span className="font-medium">{names.get(log.actorId) ?? `${log.actorId.slice(0, 8)}…`}</span>
            {log.actorRole ? <span className="text-[13px] text-ink-secondary">{ROLE_LABELS[log.actorRole]}</span> : null}
          </span>
        ) : (
          <span className="text-ink-secondary">Tizim / anonim</span>
        ),
    },
    { key: 'action', header: 'Amal', cell: (log) => auditActionLabel(log.action) },
    {
      key: 'target',
      header: 'Obyekt',
      cell: (log) => (
        <span className="flex flex-col">
          <span>{AUDIT_RESOURCE_LABELS[log.resourceType] ?? log.resourceType}</span>
          {log.resourceId ? (
            <span className="font-mono text-[12px] text-ink-secondary">{log.resourceId.slice(0, 13)}…</span>
          ) : null}
        </span>
      ),
    },
    { key: 'ip', header: 'IP', hideOnMobile: true, cell: (log) => log.ip ?? '—' },
    {
      key: 'details',
      header: <span className="sr-only">Batafsil</span>,
      align: 'right',
      hideOnMobile: true,
      cell: (log) => (
        <IconButton label="Batafsil ko‘rish" icon={<Eye aria-hidden className="size-4" />} onClick={() => setSelected(log)} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="grid gap-3 px-4 py-4 lg:grid-cols-[2fr_1.2fr_1fr_1.4fr] lg:items-end">
          <DateRangeFilter
            value={range}
            onChange={(next) => {
              setRange(next);
              setPage(1);
            }}
          />
          <Field label="Amal">
            <Select
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Barcha amallar</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Obyekt turi">
            <Select
              value={resourceType}
              onChange={(event) => {
                setResourceType(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Barchasi</option>
              {Object.entries(AUDIT_RESOURCE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Bajaruvchi ID" hint={actorInput && !actorId ? 'To‘liq UUID kiriting' : undefined}>
            <Input
              autoComplete="off"
              placeholder="UUID"
              value={actorInput}
              onChange={(event) => {
                setActorInput(event.target.value);
                setPage(1);
              }}
            />
          </Field>
        </div>
        <p className="border-t border-line px-4 py-2.5 text-sm text-ink-secondary">
          Audit yozuvlari faqat o‘qish uchun — ularni o‘zgartirib yoki o‘chirib bo‘lmaydi.
        </p>
      </Card>

      <Card>
        <AsyncContent
          query={logs}
          collection
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              icon={<ScrollText className="size-6" />}
              title="Yozuvlar topilmadi"
              description="Sana oralig‘i yoki filtrlarni o‘zgartiring."
            />
          }
        >
          {(data) => (
            <>
              <DataTable
                caption="Audit loglar"
                columns={columns}
                rows={data.items}
                rowKey={(log) => log.id}
                onRowClick={setSelected}
              />
              <Pagination page={data.page} limit={data.limit} total={data.total} onPageChange={setPage} />
            </>
          )}
        </AsyncContent>
      </Card>

      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? auditActionLabel(selected.action) : ''}
        description={selected ? formatDateTime(selected.timestamp) : undefined}
        size="lg"
        footer={<Button onClick={() => setSelected(null)}>Yopish</Button>}
      >
        {selected ? (
          <div className="flex flex-col gap-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-ink-secondary">Bajaruvchi</dt>
                <dd className="font-mono text-[13px] break-all">{selected.actorId ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-secondary">Obyekt</dt>
                <dd className="font-mono text-[13px] break-all">
                  {selected.resourceType}
                  {selected.resourceId ? ` / ${selected.resourceId}` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-ink-secondary">IP</dt>
                <dd>{selected.ip ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-ink-secondary">So‘rov ID</dt>
                <dd className="font-mono text-[13px] break-all">{selected.requestId ?? '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-ink-secondary">Qurilma</dt>
                <dd className="break-words">{selected.userAgent ?? '—'}</dd>
              </div>
            </dl>
            <div className="grid gap-3 md:grid-cols-2">
              <JsonBlock label="Avvalgi qiymat" value={selected.oldValue} />
              <JsonBlock label="Yangi qiymat" value={selected.newValue} />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
