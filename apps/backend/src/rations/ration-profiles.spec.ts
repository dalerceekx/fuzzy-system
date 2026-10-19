import {
  FeedingPurpose,
  PhysiologicalState,
  RationProfile,
} from '../generated/prisma/enums.js';
import {
  findParameterViolation,
  RATION_PROFILES,
  rationProfileConfig,
  type RationParameters,
} from './ration-profiles.js';

const params = (overrides: Partial<RationParameters> = {}) => ({
  purpose: FeedingPurpose.MAINTENANCE,
  physiologicalState: null,
  milkYieldLiters: null,
  ...overrides,
});

describe('RATION_PROFILES', () => {
  it('is exactly the published configuration, in order', () => {
    expect(JSON.parse(JSON.stringify(RATION_PROFILES))).toEqual([
      {
        profile: 'BULL',
        purposes: ['FATTENING', 'MAINTENANCE', 'BREEDING'],
        states: [],
        fields: ['averageWeightKg', 'ageMonths'],
      },
      {
        profile: 'COW',
        purposes: ['MILK', 'MAINTENANCE', 'FATTENING'],
        states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
        fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
      },
      {
        profile: 'RAM',
        purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'],
        states: [],
        fields: ['averageWeightKg', 'ageMonths'],
      },
      {
        profile: 'EWE',
        purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'],
        states: ['NORMAL', 'PREGNANT', 'LACTATING'],
        fields: ['averageWeightKg', 'ageMonths'],
      },
      {
        profile: 'OTHER',
        purposes: ['FATTENING', 'MAINTENANCE', 'MILK', 'BREEDING'],
        states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
        fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
      },
    ]);
  });

  it('covers every profile once and cannot be mutated', () => {
    expect(RATION_PROFILES.map((c) => c.profile).sort()).toEqual(
      Object.values(RationProfile).sort(),
    );
    expect(Object.isFrozen(RATION_PROFILES)).toBe(true);
    const bull = rationProfileConfig(RationProfile.BULL);
    expect(Object.isFrozen(bull)).toBe(true);
    expect(Object.isFrozen(bull.purposes)).toBe(true);
    expect(() =>
      (bull.purposes as FeedingPurpose[]).push(FeedingPurpose.MILK),
    ).toThrow();
  });
});

describe('findParameterViolation', () => {
  it('accepts parameters the profile allows', () => {
    expect(
      findParameterViolation(
        RationProfile.BULL,
        params({ purpose: FeedingPurpose.FATTENING }),
      ),
    ).toBeNull();
    expect(
      findParameterViolation(
        RationProfile.COW,
        params({
          purpose: FeedingPurpose.MILK,
          physiologicalState: PhysiologicalState.LACTATING,
          milkYieldLiters: '18.50',
        }),
      ),
    ).toBeNull();
    expect(
      findParameterViolation(
        RationProfile.EWE,
        params({ physiologicalState: PhysiologicalState.PREGNANT }),
      ),
    ).toBeNull();
    expect(
      findParameterViolation(
        RationProfile.OTHER,
        params({
          purpose: FeedingPurpose.MILK,
          physiologicalState: PhysiologicalState.DRY,
          milkYieldLiters: '0',
        }),
      ),
    ).toBeNull();
  });

  it.each([
    [RationProfile.BULL, FeedingPurpose.MILK],
    [RationProfile.RAM, FeedingPurpose.MILK],
    [RationProfile.EWE, FeedingPurpose.MILK],
    [RationProfile.COW, FeedingPurpose.BREEDING],
  ])('%s refuses purpose %s', (profile, purpose) => {
    expect(findParameterViolation(profile, params({ purpose }))).toBe(
      'purpose',
    );
  });

  it.each([
    [RationProfile.BULL, PhysiologicalState.PREGNANT],
    [RationProfile.BULL, PhysiologicalState.NORMAL],
    [RationProfile.RAM, PhysiologicalState.NORMAL],
    [RationProfile.EWE, PhysiologicalState.DRY],
  ])('%s refuses physiologicalState %s', (profile, physiologicalState) => {
    expect(
      findParameterViolation(profile, params({ physiologicalState })),
    ).toBe('physiologicalState');
  });

  it.each([RationProfile.BULL, RationProfile.RAM, RationProfile.EWE])(
    '%s refuses milkYieldLiters (even "0")',
    (profile) => {
      expect(
        findParameterViolation(profile, params({ milkYieldLiters: '0' })),
      ).toBe('milkYieldLiters');
    },
  );

  it('reports purpose first, then the state, then the milk yield', () => {
    expect(
      findParameterViolation(RationProfile.BULL, {
        purpose: FeedingPurpose.MILK,
        physiologicalState: PhysiologicalState.PREGNANT,
        milkYieldLiters: '10',
      }),
    ).toBe('purpose');
    expect(
      findParameterViolation(RationProfile.BULL, {
        purpose: FeedingPurpose.FATTENING,
        physiologicalState: PhysiologicalState.PREGNANT,
        milkYieldLiters: '10',
      }),
    ).toBe('physiologicalState');
  });
});
