import { useState, type FormEvent } from 'react';
import { SPECIES, type Species } from '@/features/animals/api/animals.api';
import { SPECIES_LABELS } from '@/features/animals/lib/labels';
import { errorMessage, toApiError } from '@/shared/api/errors';
import { Button, Field, FormError, Input, Modal, Select, toast } from '@/shared/ui';
import { RATION_PROFILES, type AnimalType, type RationProfile } from '../api/rations.api';
import { PROFILE_HINTS, PROFILE_LABELS } from '../lib/labels';
import { useCreateAnimalType } from '../model/rations.queries';

/** "+ Yangi hayvon turi": any category the farmer keeps, with the parameter set it uses. */
export function NewAnimalTypeDialog({
  farmId,
  onClose,
  onCreated,
}: {
  farmId: string;
  onClose: () => void;
  onCreated: (type: AnimalType) => void;
}) {
  const create = useCreateAnimalType();
  const [name, setName] = useState('');
  const [species, setSpecies] = useState<Species>('GOAT');
  const [sex, setSex] = useState<'' | 'MALE' | 'FEMALE'>('');
  const [profile, setProfile] = useState<RationProfile>('OTHER');
  const [submitted, setSubmitted] = useState(false);
  const trimmed = name.trim();
  const nameError = submitted && !trimmed ? 'Nomini kiriting' : trimmed.length > 60 ? 'Ko‘pi bilan 60 ta belgi' : undefined;
  const duplicate = toApiError(create.error).code === 'RATION_ANIMAL_TYPE_EXISTS';

  function submit(event: FormEvent): void {
    event.preventDefault();
    setSubmitted(true);
    if (!trimmed || trimmed.length > 60 || create.isPending) return;
    create.mutate(
      { farmId, name: trimmed, species, profile, ...(sex ? { sex } : {}) },
      {
        onSuccess: (type) => {
          toast.success(`“${type.name}” qo‘shildi`);
          onCreated(type);
        },
      },
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Yangi hayvon turi"
      description="Masalan: Echki, Buzoq, Taka. Har bir turning ratsionlari alohida hisoblanadi."
      dismissible={!create.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Bekor qilish
          </Button>
          <Button type="submit" form="animal-type-form" loading={create.isPending}>
            Qo‘shish
          </Button>
        </>
      }
    >
      <form id="animal-type-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nomi"
          error={nameError ?? (duplicate ? 'Bunday nomli tur bor' : undefined)}
          required
          className="sm:col-span-2"
        >
          <Input data-autofocus autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Hayvon turi (podadagi)" hint="Fermadagi sonini topish uchun">
          <Select value={species} onChange={(event) => setSpecies(event.target.value as Species)}>
            {SPECIES.map((value) => (
              <option key={value} value={value}>
                {SPECIES_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Jinsi">
          <Select value={sex} onChange={(event) => setSex(event.target.value as '' | 'MALE' | 'FEMALE')}>
            <option value="">Har qanday</option>
            <option value="MALE">Erkak</option>
            <option value="FEMALE">Urg‘ochi</option>
          </Select>
        </Field>
        <Field label="Parametrlar" hint={PROFILE_HINTS[profile]} className="sm:col-span-2">
          <Select value={profile} onChange={(event) => setProfile(event.target.value as RationProfile)}>
            {RATION_PROFILES.map((value) => (
              <option key={value} value={value}>
                {PROFILE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <FormError message={create.error && !duplicate ? errorMessage(create.error) : null} />
        </div>
      </form>
    </Modal>
  );
}
