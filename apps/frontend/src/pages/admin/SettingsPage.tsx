import { Card, GapState } from '@/shared/ui';

export default function SettingsPage() {
  return (
    <Card>
      <GapState
        title="Tizim sozlamalari hali backend’da mavjud emas"
        description="Sozlamalar (masalan SMS, fayl hajmi, sessiya muddatlari) hozircha server muhit o‘zgaruvchilari orqali boshqariladi. API qo‘shilgach, ular shu yerda ko‘rinadi."
      />
    </Card>
  );
}
