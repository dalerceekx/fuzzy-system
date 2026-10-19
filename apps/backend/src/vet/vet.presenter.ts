import { toDateOnly } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  AdministrationRoute,
  DoseUnit,
  MedicineStatus,
  ProtocolVersionStatus,
  Species,
  TreatmentStatus,
} from '../generated/prisma/enums.js';
import { decimalString, DOSE_SCALE, WEIGHT_SCALE } from './dosing.js';
import { EMERGENCY_ADVICE } from './vet.errors.js';

// ---------------------------------------------------------------------------
// Medicines
// ---------------------------------------------------------------------------

export interface MedicineResponse {
  id: string;
  name: string;
  activeIngredient: string;
  form: string | null;
  concentration: string | null;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  status: MedicineStatus;
  isDemo: boolean;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Staff only. */
  createdById?: string;
  approvedById?: string | null;
}

type MedicineRow = Prisma.MedicineGetPayload<object>;

export function toMedicineResponse(
  medicine: MedicineRow,
  staffView: boolean,
): MedicineResponse {
  return {
    id: medicine.id,
    name: medicine.name,
    activeIngredient: medicine.activeIngredient,
    form: medicine.form,
    concentration: medicine.concentration,
    withdrawalMeatDays: medicine.withdrawalMeatDays,
    withdrawalMilkDays: medicine.withdrawalMilkDays,
    status: medicine.status,
    isDemo: medicine.isDemo,
    approvedAt: medicine.approvedAt,
    createdAt: medicine.createdAt,
    updatedAt: medicine.updatedAt,
    ...(staffView
      ? {
          createdById: medicine.createdById,
          approvedById: medicine.approvedById,
        }
      : {}),
  };
}

/** Audit view (no ids of other users, no timestamps). */
export function medicineAuditValue(medicine: MedicineRow) {
  return {
    name: medicine.name,
    activeIngredient: medicine.activeIngredient,
    form: medicine.form,
    concentration: medicine.concentration,
    withdrawalMeatDays: medicine.withdrawalMeatDays,
    withdrawalMilkDays: medicine.withdrawalMilkDays,
    status: medicine.status,
    isDemo: medicine.isDemo,
  };
}

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------

export const DRUG_INCLUDE = {
  medicine: {
    select: {
      id: true,
      name: true,
      activeIngredient: true,
      status: true,
      withdrawalMeatDays: true,
      withdrawalMilkDays: true,
    },
  },
} satisfies Prisma.ProtocolDrugInclude;

export const VERSION_INCLUDE = {
  drugs: {
    include: DRUG_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ProtocolVersionInclude;

type DrugRow = Prisma.ProtocolDrugGetPayload<{ include: typeof DRUG_INCLUDE }>;
export type VersionRow = Prisma.ProtocolVersionGetPayload<{
  include: typeof VERSION_INCLUDE;
}>;
type ProtocolRow = Prisma.ProtocolGetPayload<object>;

export interface ProtocolDrugResponse {
  medicineId: string;
  medicineName: string;
  activeIngredient: string;
  dosePerKg: string;
  doseUnit: DoseUnit;
  maxSingleDose: string | null;
  route: AdministrationRoute;
  frequencyPerDay: number;
  durationDays: number;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  /** Staff only. */
  medicineStatus?: MedicineStatus;
}

export interface ProtocolVersionResponse {
  id: string;
  protocolId: string;
  version: number;
  status: ProtocolVersionStatus;
  title: string;
  condition: string;
  isEmergency: boolean;
  instructions: string;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Always empty for emergency versions shown to farmers. */
  drugs: ProtocolDrugResponse[];
  /** Set for emergency versions: what to do instead of medicating. */
  emergencyAdvice: string | null;
  /** Staff only. */
  createdById?: string;
  approvedById?: string | null;
}

export interface ProtocolSummaryResponse {
  id: string;
  code: string;
  species: Species;
  isDemo: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Staff: every version. Farmer: only the APPROVED version. */
export interface ProtocolResponse extends ProtocolSummaryResponse {
  approvedVersion: ProtocolVersionResponse | null;
  versions?: ProtocolVersionResponse[];
}

export function toDrugResponse(
  drug: DrugRow,
  staffView: boolean,
): ProtocolDrugResponse {
  return {
    medicineId: drug.medicineId,
    medicineName: drug.medicine.name,
    activeIngredient: drug.medicine.activeIngredient,
    dosePerKg: decimalString(drug.dosePerKg, DOSE_SCALE),
    doseUnit: drug.doseUnit,
    maxSingleDose:
      drug.maxSingleDose === null
        ? null
        : decimalString(drug.maxSingleDose, DOSE_SCALE),
    route: drug.route,
    frequencyPerDay: drug.frequencyPerDay,
    durationDays: drug.durationDays,
    withdrawalMeatDays: drug.medicine.withdrawalMeatDays,
    withdrawalMilkDays: drug.medicine.withdrawalMilkDays,
    ...(staffView ? { medicineStatus: drug.medicine.status } : {}),
  };
}

export function toVersionResponse(
  version: VersionRow,
  staffView: boolean,
): ProtocolVersionResponse {
  // Emergency protocols never put medicines in front of a farmer.
  const showDrugs = staffView || !version.isEmergency;
  return {
    id: version.id,
    protocolId: version.protocolId,
    version: version.version,
    status: version.status,
    title: version.title,
    condition: version.condition,
    isEmergency: version.isEmergency,
    instructions: version.instructions,
    approvedAt: version.approvedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    drugs: showDrugs
      ? version.drugs.map((drug) => toDrugResponse(drug, staffView))
      : [],
    emergencyAdvice: version.isEmergency ? EMERGENCY_ADVICE : null,
    ...(staffView
      ? { createdById: version.createdById, approvedById: version.approvedById }
      : {}),
  };
}

export function toProtocolSummary(
  protocol: ProtocolRow,
): ProtocolSummaryResponse {
  return {
    id: protocol.id,
    code: protocol.code,
    species: protocol.species,
    isDemo: protocol.isDemo,
    archivedAt: protocol.archivedAt,
    createdAt: protocol.createdAt,
    updatedAt: protocol.updatedAt,
  };
}

/** Audit view of a version's clinical content (`code` would be redacted). */
export function versionAuditValue(version: VersionRow) {
  return {
    version: version.version,
    status: version.status,
    title: version.title,
    condition: version.condition,
    isEmergency: version.isEmergency,
    instructions: version.instructions,
    drugs: version.drugs.map((drug) => ({
      medicineId: drug.medicineId,
      dosePerKg: decimalString(drug.dosePerKg, DOSE_SCALE),
      doseUnit: drug.doseUnit,
      maxSingleDose:
        drug.maxSingleDose === null
          ? null
          : decimalString(drug.maxSingleDose, DOSE_SCALE),
      route: drug.route,
      frequencyPerDay: drug.frequencyPerDay,
      durationDays: drug.durationDays,
    })),
  };
}

// ---------------------------------------------------------------------------
// Treatments
// ---------------------------------------------------------------------------

export const TREATMENT_INCLUDE = {
  doses: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.TreatmentInclude;

type TreatmentRow = Prisma.TreatmentGetPayload<{
  include: typeof TREATMENT_INCLUDE;
}>;

export interface TreatmentDoseResponse {
  id: string;
  medicineId: string;
  medicineName: string;
  inventoryItemId: string | null;
  dosePerKg: string;
  doseUnit: DoseUnit;
  singleDose: string;
  route: AdministrationRoute;
  frequencyPerDay: number;
  durationDays: number;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  batchNumber: string | null;
  itemExpiresOn: string | null;
}

export interface TreatmentResponse {
  id: string;
  farmId: string;
  animalId: string;
  protocolVersionId: string;
  status: TreatmentStatus;
  startedAt: Date;
  /** 'YYYY-MM-DD' (Asia/Tashkent calendar) */
  endsOn: string;
  animalWeightKg: string;
  withdrawalMeatUntil: string;
  withdrawalMilkUntil: string;
  warning: string;
  notes: string | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  protocolSnapshot: unknown;
  doses: TreatmentDoseResponse[];
}

export function withdrawalWarning(
  meatUntil: string,
  milkUntil: string,
): string {
  return (
    `Diqqat: go‘sht ${meatUntil} kuni (shu kun ham) va sut ${milkUntil} kuni ` +
    '(shu kun ham) tugaguncha iste’mol qilinmasin va sotilmasin. ' +
    'Davolash veterinar nazoratida o‘tkazilishi kerak.'
  );
}

export function toTreatmentResponse(
  treatment: TreatmentRow,
): TreatmentResponse {
  const meatUntil = toDateOnly(treatment.withdrawalMeatUntil);
  const milkUntil = toDateOnly(treatment.withdrawalMilkUntil);
  return {
    id: treatment.id,
    farmId: treatment.farmId,
    animalId: treatment.animalId,
    protocolVersionId: treatment.protocolVersionId,
    status: treatment.status,
    startedAt: treatment.startedAt,
    endsOn: toDateOnly(treatment.endsOn),
    animalWeightKg: decimalString(treatment.animalWeightKg, WEIGHT_SCALE),
    withdrawalMeatUntil: meatUntil,
    withdrawalMilkUntil: milkUntil,
    warning: withdrawalWarning(meatUntil, milkUntil),
    notes: treatment.notes,
    completedAt: treatment.completedAt,
    cancelledAt: treatment.cancelledAt,
    createdAt: treatment.createdAt,
    updatedAt: treatment.updatedAt,
    protocolSnapshot: treatment.protocolSnapshot,
    doses: treatment.doses.map((dose) => ({
      id: dose.id,
      medicineId: dose.medicineId,
      medicineName: dose.medicineName,
      inventoryItemId: dose.inventoryItemId,
      dosePerKg: decimalString(dose.dosePerKg, DOSE_SCALE),
      doseUnit: dose.doseUnit,
      singleDose: decimalString(dose.singleDose, DOSE_SCALE),
      route: dose.route,
      frequencyPerDay: dose.frequencyPerDay,
      durationDays: dose.durationDays,
      withdrawalMeatDays: dose.withdrawalMeatDays,
      withdrawalMilkDays: dose.withdrawalMilkDays,
      batchNumber: dose.batchNumber,
      itemExpiresOn: dose.itemExpiresOn ? toDateOnly(dose.itemExpiresOn) : null,
    })),
  };
}
