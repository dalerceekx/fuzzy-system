import {
  AdministrationRoute,
  AnimalSex,
  DoseUnit,
  InventoryCategory,
  InventoryUnit,
  Species,
} from '../../src/generated/prisma/enums.js';

// Every piece of demo clinical content carries this label, and the database
// refuses to approve demo medicines/protocols, so demo data can never be
// mistaken for a validated treatment.
export const DEMO_CLINICAL_LABEL = 'DEMO — klinik tasdiqlanmagan';

export const DEMO_FARM = { name: 'Demo ferma', region: 'Toshkent viloyati' };

export const DEMO_ANIMALS = [
  {
    tagNumber: 'DEMO-001',
    name: 'Malika',
    species: Species.CATTLE,
    sex: AnimalSex.FEMALE,
    weightKg: '420.50',
  },
  {
    tagNumber: 'DEMO-002',
    name: 'Oqqo‘y',
    species: Species.SHEEP,
    sex: AnimalSex.MALE,
    weightKg: '55.00',
  },
  {
    tagNumber: 'DEMO-003',
    name: null,
    species: Species.GOAT,
    sex: AnimalSex.UNKNOWN,
    weightKg: null,
  },
] as const;

export interface DemoInventoryItem {
  name: string;
  category: InventoryCategory;
  unit: InventoryUnit;
  initialQuantity: string;
  /** So‘m per unit: the IN movement carries it as unitCost (UZS). */
  unitPrice: string | null;
}

const demoFeed = (
  name: string,
  initialQuantity: string,
  unitPrice: string,
): DemoInventoryItem => ({
  name,
  category: InventoryCategory.FEED,
  unit: InventoryUnit.KG,
  initialQuantity,
  unitPrice,
});

/** Stock is written as a single IN movement so the ledger stays consistent. */
export const DEMO_INVENTORY: readonly DemoInventoryItem[] = [
  {
    name: 'Demo yem: bug‘doy kepagi',
    category: InventoryCategory.FEED,
    unit: InventoryUnit.KG,
    initialQuantity: '250.000',
    unitPrice: null,
  },
  {
    name: 'Demo jihoz: shprits 5 ml',
    category: InventoryCategory.EQUIPMENT,
    unit: InventoryUnit.PIECE,
    initialQuantity: '40.000',
    unitPrice: null,
  },
  // Priced feeds for the feed warehouse and the ration calculator.
  demoFeed('Makkajo‘xori', '500.000', '3500.00'),
  demoFeed('Beda', '300.000', '2000.00'),
  demoFeed('Kepak', '200.000', '2800.00'),
  demoFeed('Somon', '400.000', '1000.00'),
  demoFeed('Arpa', '250.000', '3200.00'),
];

export const DEMO_MEDICINES = [
  {
    key: 'antibiotic',
    name: `${DEMO_CLINICAL_LABEL}: namunaviy antibiotik`,
    activeIngredient: 'Namunaviy modda A (demo)',
    form: 'eritma',
    concentration: 'demo',
    withdrawalMeatDays: 28,
    withdrawalMilkDays: 7,
  },
  {
    key: 'antiInflammatory',
    name: `${DEMO_CLINICAL_LABEL}: namunaviy yallig‘lanishga qarshi vosita`,
    activeIngredient: 'Namunaviy modda B (demo)',
    form: 'eritma',
    concentration: 'demo',
    withdrawalMeatDays: 5,
    withdrawalMilkDays: 3,
  },
] as const;

export const DEMO_PROTOCOL = {
  code: 'DEMO-MASTIT',
  species: Species.CATTLE,
  title: `${DEMO_CLINICAL_LABEL}: mastit (namuna)`,
  condition: 'mastit (demo)',
  instructions:
    `${DEMO_CLINICAL_LABEL}. Bu faqat interfeysni sinash uchun namuna, ` +
    'davolash tavsiyasi emas. Hayvonni davolash uchun veterinar shifokorga ' +
    'murojaat qiling.',
  drugs: [
    {
      medicine: 'antibiotic',
      dosePerKg: '0.1000',
      doseUnit: DoseUnit.ML,
      route: AdministrationRoute.IM,
      frequencyPerDay: 1,
      durationDays: 3,
    },
    {
      medicine: 'antiInflammatory',
      dosePerKg: '0.0250',
      doseUnit: DoseUnit.ML,
      route: AdministrationRoute.SC,
      frequencyPerDay: 1,
      durationDays: 1,
    },
  ],
} as const;
