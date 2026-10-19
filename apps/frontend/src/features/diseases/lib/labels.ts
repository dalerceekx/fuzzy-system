import type { DiseaseAnimal } from '../api/diseases.api';

export const ANIMAL_LABELS: Record<DiseaseAnimal, string> = {
  CATTLE: 'Qoramol / sigir',
  CALF: 'Buzoq',
  SHEEP: 'Qo‘y / sovliq',
  LAMB: 'Qo‘zi',
};

/** Shown at the top of every disease and of the source text (wording required by the product owner). */
export const SAFETY_NOTICE =
  'Bu ma’lumot ilova qilingan manba matnidan olingan. Davolash va dori dozasini qo‘llashdan oldin veterinar bilan tasdiqlang.';

export const SOURCE_STATUS_LABEL = 'Manba matni — veterinar tasdig‘i talab qilinadi';
