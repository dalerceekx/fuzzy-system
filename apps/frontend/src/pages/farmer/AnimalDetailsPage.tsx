import { Archive, ArrowLeft, PawPrint, Pencil, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AnimalFormDialog } from '@/features/animals/components/AnimalFormDialog';
import { ArchiveAnimalDialog } from '@/features/animals/components/ArchiveAnimalDialog';
import {
  ageCategory,
  AGE_CATEGORY_LABELS,
  ageLabel,
  SEX_LABELS,
  SPECIES_LABELS,
  speciesWithKind,
} from '@/features/animals/lib/labels';
import { useAnimal } from '@/features/animals/model/animals.queries';
import { useActiveFarm } from '@/features/farms/model/active-farm';
import { formatDate, formatDateTime, formatDecimal } from '@/shared/lib/format';
import { Alert, AsyncContent, Badge, Button, ButtonLink, Card, CardBody, CardHeader, DescriptionList } from '@/shared/ui';

export default function AnimalDetailsPage() {
  const { animalId = '' } = useParams();
  const navigate = useNavigate();
  const animal = useAnimal(animalId);
  const { farms } = useActiveFarm();
  const [editing, setEditing] = useState(false);
  const [archiving, setArchiving] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to="/animals" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          Hayvonlar ro‘yxati
        </ButtonLink>
      </div>
      <Card>
        <AsyncContent query={animal}>
          {(data) => {
            const farm = farms.find((candidate) => candidate.id === data.farmId);
            return (
              <>
                <CardHeader
                  icon={<PawPrint className="size-5" />}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {data.tagNumber}
                      {data.name ? <span className="font-normal text-ink-secondary">“{data.name}”</span> : null}
                      {data.archivedAt ? <Badge tone="neutral">Arxivda</Badge> : <Badge tone="success">Faol</Badge>}
                    </span>
                  }
                  description={[speciesWithKind(data.species, data.sex).species, speciesWithKind(data.species, data.sex).kind]
                    .filter(Boolean)
                    .join(' · ')}
                  actions={
                    data.archivedAt ? null : (
                      <>
                        <Button
                          variant="secondary"
                          icon={<Pencil aria-hidden className="size-4" />}
                          onClick={() => setEditing(true)}
                        >
                          Tahrirlash
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<Archive aria-hidden className="size-4" />}
                          onClick={() => setArchiving(true)}
                        >
                          Arxivlash
                        </Button>
                      </>
                    )
                  }
                />
                <CardBody className="flex flex-col gap-5">
                  {data.activeWithdrawal ? (
                    <Alert tone="warning" title="Davolashdan keyingi kutish muddati" urgent>
                      {[
                        data.activeWithdrawal.meatUntil ? `Go‘shtini ${formatDate(data.activeWithdrawal.meatUntil)} gacha` : null,
                        data.activeWithdrawal.milkUntil ? `sutini ${formatDate(data.activeWithdrawal.milkUntil)} gacha` : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}{' '}
                      sotish yoki iste’mol qilish mumkin emas.
                    </Alert>
                  ) : null}
                  {data.archivedAt ? (
                    <Alert tone="info" title="Arxivlangan">
                      {formatDateTime(data.archivedAt)}
                      {data.archivedReason ? ` — ${data.archivedReason}` : ''}
                    </Alert>
                  ) : null}
                  <DescriptionList
                    items={[
                      { label: 'Turi', value: SPECIES_LABELS[data.species] },
                      { label: 'Jinsi', value: SEX_LABELS[data.sex] },
                      { label: 'Tug‘ilgan sana', value: formatDate(data.birthDate) },
                      {
                        label: 'Yoshi',
                        value: `${ageLabel(data.birthDate)} (${AGE_CATEGORY_LABELS[ageCategory(data.birthDate)]})`,
                      },
                      {
                        label: 'Vazni',
                        value: data.weightKg ? `${formatDecimal(data.weightKg, { maxFractionDigits: 2 })} kg` : '—',
                      },
                      { label: 'Ferma', value: farm?.name ?? '—' },
                      { label: 'Qo‘shilgan', value: formatDateTime(data.createdAt) },
                      { label: 'Oxirgi o‘zgarish', value: formatDateTime(data.updatedAt) },
                    ]}
                  />
                  {data.notes ? (
                    <div>
                      <p className="text-[13px] text-ink-secondary">Izoh</p>
                      <p className="mt-0.5 whitespace-pre-line">{data.notes}</p>
                    </div>
                  ) : null}
                  <p className="flex items-center gap-2 text-[13px] text-ink-secondary">
                    <TriangleAlert aria-hidden className="size-4" />
                    Davolash tarixi va hujjatlar bo‘limi keyingi bosqichda qo‘shiladi.
                  </p>
                </CardBody>
                <AnimalFormDialog
                  open={editing}
                  animal={data}
                  farmId={data.farmId}
                  farmName={farm?.name ?? ''}
                  onClose={() => setEditing(false)}
                />
                <ArchiveAnimalDialog
                  animal={archiving ? data : null}
                  onClose={() => setArchiving(false)}
                  onArchived={() => navigate('/animals')}
                />
              </>
            );
          }}
        </AsyncContent>
      </Card>
    </div>
  );
}
