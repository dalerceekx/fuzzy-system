import { FlaskConical } from 'lucide-react';
import { formatPhone } from '@/shared/lib/phone';
import { Button } from '@/shared/ui';

interface DemoAccount {
  label: string;
  phone: string;
  password: string;
}

/**
 * DEVELOPMENT ONLY. Loaded through a dynamic import guarded by
 * `import.meta.env.DEV`; values come from .env.development.local and must
 * match the backend demo seed.
 */
function demoAccounts(): DemoAccount[] {
  const candidates = [
    {
      label: 'Super admin',
      phone: import.meta.env.VITE_DEMO_SUPER_ADMIN_PHONE,
      password: import.meta.env.VITE_DEMO_SUPER_ADMIN_PASSWORD,
    },
    {
      label: 'Fermer',
      phone: import.meta.env.VITE_DEMO_FARMER_PHONE,
      password: import.meta.env.VITE_DEMO_FARMER_PASSWORD,
    },
  ];
  return candidates.filter((account): account is DemoAccount => Boolean(account.phone && account.password));
}

export default function DemoAccounts({
  onPick,
  disabled,
}: {
  onPick: (phone: string, password: string) => void;
  disabled: boolean;
}) {
  const accounts = demoAccounts();
  if (accounts.length === 0) return null;
  return (
    <section
      aria-label="Demo akkauntlar"
      className="rounded-[12px] border border-dashed border-input-line bg-background px-4 py-3"
    >
      <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <FlaskConical aria-hidden className="size-4 text-warning" />
        Demo akkauntlar — faqat development
      </p>
      <div className="mt-2.5 flex flex-col gap-2">
        {accounts.map((account) => (
          <Button
            key={account.label}
            variant="secondary"
            size="sm"
            fullWidth
            disabled={disabled}
            onClick={() => onPick(account.phone, account.password)}
          >
            {account.label} · {formatPhone(account.phone)}
          </Button>
        ))}
      </div>
    </section>
  );
}
