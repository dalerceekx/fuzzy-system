import { http } from '@/shared/api/client';
import { cleanParams } from '@/shared/api/pagination';

/** Backend enum DiseaseAnimal (Qoramol/sigir, Buzoq, Qo‘y/sovliq, Qo‘zi). */
export const DISEASE_ANIMALS = ['CATTLE', 'CALF', 'SHEEP', 'LAMB'] as const;
export type DiseaseAnimal = (typeof DISEASE_ANIMALS)[number];

/** How a source line reads; the text itself is always the exact original line. */
export type DiseaseLineKind = 'title' | 'symptoms' | 'scheme' | 'subheading' | 'item';

export interface DiseaseGroup {
  number: number;
  /** Exact source line, e.g. "1-Bo'lim. Teri, …". */
  heading: string;
  title: string;
  diseaseCount: number;
}

export interface DiseaseSummary {
  number: number;
  groupNumber: number;
  title: string;
  name: string;
  scientificNames: string | null;
  symptoms: string | null;
  animals: DiseaseAnimal[];
  /** Source text only — a veterinarian has not confirmed it. */
  status: 'SOURCE_TEXT';
}

export interface DiseaseDetails extends DiseaseSummary {
  group: Pick<DiseaseGroup, 'number' | 'heading' | 'title'>;
  lines: Array<{ kind: DiseaseLineKind; text: string }>;
  /** Every line of this disease, unchanged. */
  fullText: string;
  abbreviations: string;
}

export interface DiseaseSource {
  key: string;
  abbreviations: string;
  /** The whole source text, unchanged. */
  fullText: string;
  checksum: string;
  groupCount: number;
  diseaseCount: number;
}

export interface DiseaseFilters {
  animal?: DiseaseAnimal;
  groupNumber?: number;
  q?: string;
}

/** /api/v1/diseases — read-only reference text, every signed-in role. */
export const diseasesApi = {
  async groups(): Promise<DiseaseGroup[]> {
    const { data } = await http.get<DiseaseGroup[]>('/diseases/groups');
    return data;
  },

  async list(filters: DiseaseFilters): Promise<DiseaseSummary[]> {
    const { data } = await http.get<DiseaseSummary[]>('/diseases', { params: cleanParams({ ...filters }) });
    return data;
  },

  async get(number: number): Promise<DiseaseDetails> {
    const { data } = await http.get<DiseaseDetails>(`/diseases/${number}`);
    return data;
  },

  async source(): Promise<DiseaseSource> {
    const { data } = await http.get<DiseaseSource>('/diseases/source');
    return data;
  },
};
