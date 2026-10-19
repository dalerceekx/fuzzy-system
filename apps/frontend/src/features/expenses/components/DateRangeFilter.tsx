import { todayInTashkent } from '@/shared/lib/dates';
import { Field, Input } from '@/shared/ui';
import type { DateRange } from '@/features/inventory/lib/ledger';

/** Two native date inputs ("Dan" / "Gacha"), Tashkent calendar dates. */
export function DateRangeFilter({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const today = todayInTashkent();
  return (
    <div className="grid grid-cols-2 gap-3 sm:min-w-[300px]">
      <Field label="Dan">
        <Input
          type="date"
          max={value.to}
          value={value.from}
          onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })}
        />
      </Field>
      <Field label="Gacha">
        <Input
          type="date"
          min={value.from}
          max={today}
          value={value.to}
          onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })}
        />
      </Field>
    </div>
  );
}
