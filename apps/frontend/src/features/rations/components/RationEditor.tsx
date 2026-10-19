import { ArrowLeft, Calculator, PawPrint, Plus, Save, Trash2, Users, Wheat } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useFarmAnimals } from '@/features/animals/model/animals.queries';
import type { Farm } from '@/features/farms/api/farms.api';
import { formatQuantity, UNIT_SHORT } from '@/features/inventory/lib/labels';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { errorMessage } from '@/shared/api/errors';
import { Decimal } from '@/shared/lib/decimal';
import { formatDecimal, formatMoney } from '@/shared/lib/format';
import { decimalProblem, normalizeDecimal, type DecimalRule } from '@/shared/lib/validation';
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  FormError,
  IconButton,
  Input,
  Select,
  Textarea,
  toast,
} from '@/shared/ui';
import type { AnimalType, FeedingPurpose, PhysiologicalState, ProfileConfig, Ration, RationInput } from '../api/rations.api';
import { belongsToType, FIELD_LABELS, PROFILE_HINTS, PURPOSE_LABELS, STATE_LABELS } from '../lib/labels';
import { useSaveRation } from '../model/rations.queries';
import { RationResultView, type ResultLine } from './RationResultView';

export type EditorAnimalType = Pick<AnimalType, 'id' | 'name' | 'profile' | 'species' | 'sex'>;

/** Backend limits (contract §4.3). */
const RULES = {
  count: { maxIntegerDigits: 7, maxFractionDigits: 0, positive: true, max: '1000000' },
  weight: { maxIntegerDigits: 6, maxFractionDigits: 2, positive: true },
  age: { maxIntegerDigits: 3, maxFractionDigits: 0, max: '600' },
  milk: { maxIntegerDigits: 4, maxFractionDigits: 2 },
  days: { maxIntegerDigits: 4, maxFractionDigits: 0, positive: true, max: '3650' },
  daily: { maxIntegerDigits: 6, maxFractionDigits: 3, positive: true },
} satisfies Record<string, DecimalRule>;

const DAY_PRESETS = ['7', '30', '90'] as const;
const MAX_LINES = 20;

interface Line {
  key: string;
  itemId: string;
  daily: string;
}

interface Parsed {
  value: Decimal | null;
  error: string | undefined;
}

/** Empty is an error only once the farmer tried to save a required field. */
function parse(value: string, rule: DecimalRule, required: boolean, submitted: boolean): Parsed {
  if (value.trim() === '') return { value: null, error: required && submitted ? 'Qiymatni kiriting' : undefined };
  const problem = decimalProblem(value, rule);
  return problem ? { value: null, error: problem } : { value: Decimal.from(value), error: undefined };
}

const toInput = (value: string | null | undefined) => (value ? Decimal.from(value).toString() : '');
const newLine = (itemId = '', daily = ''): Line => ({ key: crypto.randomUUID(), itemId, daily });

/**
 * Ration form (spec 4.1–4.3): the animal parameters the profile asks for,
 * feeds picked from the warehouse with a per-animal daily amount, and the
 * live result. Saving stores the ration only — stock is untouched.
 */
export function RationEditor({
  farm,
  type,
  config,
  ration,
  backTo,
}: {
  farm: Farm;
  type: EditorAnimalType;
  config: ProfileConfig;
  ration?: Ration;
  backTo: string;
}) {
  const navigate = useNavigate();
  const save = useSaveRation(farm.id);
  const feed = useInventoryItems(farm.id, 'FEED');
  const animals = useFarmAnimals(farm.id);
  const feedItems = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const has = (field: ProfileConfig['fields'][number]) => config.fields.includes(field);

  const [submitted, setSubmitted] = useState(false);
  const [name, setName] = useState(ration?.name ?? '');
  const [count, setCount] = useState(ration ? String(ration.animalCount) : '');
  const [weight, setWeight] = useState(toInput(ration?.averageWeightKg));
  const [age, setAge] = useState(ration?.ageMonths != null ? String(ration.ageMonths) : '');
  const [purpose, setPurpose] = useState<FeedingPurpose>(ration?.purpose ?? config.purposes[0] ?? 'MAINTENANCE');
  const [state, setState] = useState<PhysiologicalState | ''>(ration?.physiologicalState ?? '');
  const [milk, setMilk] = useState(toInput(ration?.milkYieldLiters));
  const [days, setDays] = useState(ration ? String(ration.days) : '30');
  const [notes, setNotes] = useState(ration?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    ration?.items.length ? ration.items.map((line) => newLine(line.inventoryItemId, toInput(line.dailyPerAnimal))) : [newLine()],
  );

  // Herd of this category on the farm (server data) — a suggestion only.
  const herd = useMemo(() => (animals.data?.items ?? []).filter((animal) => belongsToType(animal, type)), [animals.data, type]);
  const weighed = herd.flatMap((animal) => (animal.weightKg ? [Decimal.from(animal.weightKg)] : []));
  const herdWeight = weighed.length > 0 ? Decimal.sum(weighed).div(Decimal.from(weighed.length), 2) : null;

  function validate(strict: boolean) {
    const nameError =
      strict && !name.trim() ? 'Ratsion nomini kiriting' : name.trim().length > 100 ? 'Ko‘pi bilan 100 ta belgi' : undefined;
    const fields = {
      count: parse(count, RULES.count, true, strict),
      weight: has('averageWeightKg') ? parse(weight, RULES.weight, false, strict) : { value: null, error: undefined },
      age: has('ageMonths') ? parse(age, RULES.age, false, strict) : { value: null, error: undefined },
      milk: has('milkYieldLiters') ? parse(milk, RULES.milk, false, strict) : { value: null, error: undefined },
      days: parse(days, RULES.days, true, strict),
    };
    const notesError = notes.trim().length > 500 ? 'Ko‘pi bilan 500 ta belgi' : undefined;
    const rows = lines.map((line) => ({
      line,
      item: feedItems.find((item) => item.id === line.itemId) ?? null,
      daily: parse(line.daily, RULES.daily, true, strict),
      itemError: strict && !line.itemId ? 'Yemni tanlang' : undefined,
    }));
    const hasErrors =
      Boolean(nameError || notesError) ||
      Object.values(fields).some((field) => field.error) ||
      rows.some((row) => row.itemError || row.daily.error);
    return { nameError, notesError, fields, rows, hasErrors };
  }

  const view = validate(submitted);
  const chosen = new Set(lines.map((line) => line.itemId).filter(Boolean));
  const resultLines: ResultLine[] = view.rows.flatMap((row) =>
    row.item && row.daily.value
      ? [
          {
            name: row.item.name,
            unit: row.item.unit,
            dailyPerAnimal: row.daily.value,
            stock: Decimal.parse(row.item.quantity) ?? Decimal.ZERO,
            unitPrice: Decimal.parse(row.item.unitPrice),
          },
        ]
      : [],
  );
  const countValue = view.fields.count.value;
  const daysValue = view.fields.days.value;

  function updateLine(key: string, patch: Partial<Line>): void {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    const checked = validate(true);
    if (checked.hasErrors || save.isPending) return;
    const optional = {
      averageWeightKg: has('averageWeightKg') && weight.trim() ? normalizeDecimal(weight) : null,
      ageMonths: has('ageMonths') && age.trim() ? Number(normalizeDecimal(age)) : null,
      physiologicalState: config.states.length > 0 && state ? state : null,
      milkYieldLiters: has('milkYieldLiters') && milk.trim() ? normalizeDecimal(milk) : null,
      notes: notes.trim() || null,
    };
    const body: RationInput = {
      animalTypeId: type.id,
      name: name.trim(),
      animalCount: Number(normalizeDecimal(count)),
      purpose,
      days: Number(normalizeDecimal(days)),
      items: lines.map((line) => ({ inventoryItemId: line.itemId, dailyPerAnimal: normalizeDecimal(line.daily) })),
      // A new ration omits empty fields; an edited one clears them with null.
      ...(ration ? optional : Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== null))),
    };
    save.mutate(
      { id: ration?.id, body },
      {
        onSuccess: (saved) => {
          toast.success(ration ? 'Ratsion saqlandi' : 'Ratsion yaratildi');
          navigate(`/feed-calculator/rations/${saved.id}`);
        },
      },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 xl:grid-cols-5">
      <div className="flex min-w-0 flex-col gap-6 xl:col-span-3">
        <Card>
          <CardHeader
            title={`1. ${type.name}: hayvonlar`}
            description={PROFILE_HINTS[type.profile]}
            icon={<PawPrint className="size-5" />}
          />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Ratsion nomi" error={view.nameError} required className="sm:col-span-2">
              <Input
                data-autofocus
                autoComplete="off"
                placeholder="Masalan: Qishki semirtirish"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Hayvonlar soni" error={view.fields.count.error} required>
              <Input
                inputMode="numeric"
                autoComplete="off"
                placeholder="Masalan: 10"
                value={count}
                onChange={(event) => setCount(event.target.value)}
              />
            </Field>
            <div className="flex items-end">
              <Button
                variant="secondary"
                fullWidth
                icon={<Users aria-hidden className="size-4" />}
                disabled={herd.length === 0}
                onClick={() => setCount(String(herd.length))}
              >
                Fermadagi soni: {herd.length} bosh
              </Button>
            </div>
            {has('averageWeightKg') ? (
              <Field
                label={FIELD_LABELS.averageWeightKg}
                error={view.fields.weight.error}
                hint={herdWeight ? `Fermadagi o‘rtacha: ${formatDecimal(herdWeight)} kg` : 'Ixtiyoriy'}
              >
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  value={weight}
                  onChange={(event) => setWeight(event.target.value)}
                />
              </Field>
            ) : null}
            {has('ageMonths') ? (
              <Field label={FIELD_LABELS.ageMonths} error={view.fields.age.error} hint="Ixtiyoriy">
                <Input inputMode="numeric" autoComplete="off" value={age} onChange={(event) => setAge(event.target.value)} />
              </Field>
            ) : null}
            <Field label="Boqish maqsadi" required>
              <Select value={purpose} onChange={(event) => setPurpose(event.target.value as FeedingPurpose)}>
                {config.purposes.map((value) => (
                  <option key={value} value={value}>
                    {PURPOSE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            {config.states.length > 0 ? (
              <Field label="Fiziologik holati" hint="Ixtiyoriy">
                <Select value={state} onChange={(event) => setState(event.target.value as PhysiologicalState | '')}>
                  <option value="">Ko‘rsatilmagan</option>
                  {config.states.map((value) => (
                    <option key={value} value={value}>
                      {STATE_LABELS[value]}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            {has('milkYieldLiters') ? (
              <Field label={FIELD_LABELS.milkYieldLiters} error={view.fields.milk.error} hint="Ixtiyoriy">
                <Input inputMode="decimal" autoComplete="off" value={milk} onChange={(event) => setMilk(event.target.value)} />
              </Field>
            ) : null}
            <Field label="Oziqlantirish muddati (kun)" error={view.fields.days.error} required>
              <Input inputMode="numeric" autoComplete="off" value={days} onChange={(event) => setDays(event.target.value)} />
            </Field>
            <div className="flex items-end gap-2">
              {DAY_PRESETS.map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={days === preset ? 'primary' : 'secondary'}
                  aria-pressed={days === preset}
                  onClick={() => setDays(preset)}
                >
                  {preset} kun
                </Button>
              ))}
            </div>
            <Field label="Izoh" error={view.notesError} hint="Ixtiyoriy" className="sm:col-span-2">
              <Textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="2. Ombordagi yemlar"
            description="Yemni tanlang va bir hayvonga kuniga qancha berilishini kiriting"
            icon={<Wheat className="size-5" />}
            actions={
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus aria-hidden className="size-4" />}
                disabled={lines.length >= MAX_LINES || chosen.size >= feedItems.length}
                onClick={() => setLines((current) => [...current, newLine()])}
              >
                Yem qo‘shish
              </Button>
            }
          />
          <CardBody className="flex flex-col gap-3">
            {feed.isSuccess && feedItems.length === 0 ? (
              <EmptyState
                title="Omborda hali yem yo‘q"
                description="Ratsion ombordagi yemlardan tuziladi."
                action={
                  <ButtonLink to="/feed?new=1" variant="secondary">
                    Yem qo‘shish
                  </ButtonLink>
                }
              />
            ) : (
              view.rows.map((row, index) => {
                const unit = row.item ? UNIT_SHORT[row.item.unit] : 'kg';
                return (
                  <div
                    key={row.line.key}
                    className="grid gap-3 rounded-[12px] border border-line p-3 sm:grid-cols-[minmax(0,1fr)_170px_auto] sm:items-start"
                  >
                    <Field label={`${index + 1}-yem`} error={row.itemError}>
                      <Select
                        value={row.line.itemId}
                        disabled={feed.isPending}
                        onChange={(event) => updateLine(row.line.key, { itemId: event.target.value })}
                      >
                        <option value="">Tanlang</option>
                        {feedItems
                          .filter((item) => item.id === row.line.itemId || !chosen.has(item.id))
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} — {formatQuantity(item.quantity, item.unit)}
                            </option>
                          ))}
                      </Select>
                    </Field>
                    <Field label={`Bir boshga, kuniga (${unit})`} error={row.daily.error}>
                      <Input
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="Masalan: 8"
                        value={row.line.daily}
                        onChange={(event) => updateLine(row.line.key, { daily: event.target.value })}
                      />
                    </Field>
                    <IconButton
                      label={`${index + 1}-yemni olib tashlash`}
                      icon={<Trash2 aria-hidden className="size-4" />}
                      disabled={lines.length === 1}
                      onClick={() => setLines((current) => current.filter((line) => line.key !== row.line.key))}
                      className="sm:mt-7"
                    />
                    {row.item ? (
                      <p className="text-[13px] text-ink-secondary sm:col-span-3">
                        Omborda: {formatQuantity(row.item.quantity, row.item.unit)} ·{' '}
                        {row.item.unitPrice ? `${formatMoney(row.item.unitPrice)}/${unit}` : '1 kg narxi kiritilmagan'}
                      </p>
                    ) : null}
                  </div>
                );
              })
            )}
          </CardBody>
        </Card>
      </div>

      <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
        <Card>
          <CardHeader title="Ratsion natijalari" icon={<Calculator className="size-5" />} />
          <CardBody>
            {countValue && daysValue && resultLines.length > 0 ? (
              <RationResultView
                typeName={type.name}
                animalCount={countValue.toNumber()}
                days={daysValue.toNumber()}
                lines={resultLines}
              />
            ) : (
              <p className="py-6 text-center text-ink-secondary">
                Hayvonlar sonini, muddatni va kamida bitta yemni kiriting — natija shu yerda hisoblanadi.
              </p>
            )}
          </CardBody>
        </Card>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={save.isPending} icon={<Save aria-hidden className="size-5" />}>
            Ratsionni saqlash
          </Button>
          <ButtonLink to={backTo} variant="secondary" icon={<ArrowLeft aria-hidden className="size-5" />}>
            Orqaga
          </ButtonLink>
        </div>
        <Alert tone="info" title="Bu hisob, me’yor emas">
          Dastur oziqlantirish me’yorini tavsiya qilmaydi va ratsionni veterinariya jihatidan to‘g‘ri deb baholamaydi —
          miqdorlarni veterinar yoki zootexnik bilan kelishing. Hisoblash va saqlash ombordagi qoldiqni o‘zgartirmaydi.
        </Alert>
      </div>
    </form>
  );
}
