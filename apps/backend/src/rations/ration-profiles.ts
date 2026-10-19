import {
  FeedingPurpose,
  PhysiologicalState,
  RationProfile,
} from '../generated/prisma/enums.js';

/** Optional numeric ration parameters a profile may ask for. */
export type RationParameterField =
  'averageWeightKg' | 'ageMonths' | 'milkYieldLiters';

export interface RationProfileConfig {
  profile: RationProfile;
  /** Allowed `purpose` values. */
  purposes: readonly FeedingPurpose[];
  /** Allowed `physiologicalState` values; empty = the state must be null. */
  states: readonly PhysiologicalState[];
  /** Parameters the form shows; `milkYieldLiters` must be null otherwise. */
  fields: readonly RationParameterField[];
}

const { FATTENING, MAINTENANCE, MILK, BREEDING } = FeedingPurpose;
const { NORMAL, PREGNANT, LACTATING, DRY } = PhysiologicalState;
const BASE_FIELDS = ['averageWeightKg', 'ageMonths'] as const;
const MILK_FIELDS = [...BASE_FIELDS, 'milkYieldLiters'] as const;

function freeze(config: RationProfileConfig): RationProfileConfig {
  return Object.freeze({
    ...config,
    purposes: Object.freeze([...config.purposes]),
    states: Object.freeze([...config.states]),
    fields: Object.freeze([...config.fields]),
  });
}

/**
 * The configurable parameter sets — the single source of truth: the server
 * validates every ration against it and GET /rations/profiles serves it so
 * the client renders its form from it. No feeding norms are stored or
 * recommended (there are no veterinarian-approved norms yet).
 */
export const RATION_PROFILES: readonly RationProfileConfig[] = Object.freeze(
  [
    {
      profile: RationProfile.BULL,
      purposes: [FATTENING, MAINTENANCE, BREEDING],
      states: [],
      fields: BASE_FIELDS,
    },
    {
      profile: RationProfile.COW,
      purposes: [MILK, MAINTENANCE, FATTENING],
      states: [NORMAL, PREGNANT, LACTATING, DRY],
      fields: MILK_FIELDS,
    },
    {
      profile: RationProfile.RAM,
      purposes: [MAINTENANCE, BREEDING, FATTENING],
      states: [],
      fields: BASE_FIELDS,
    },
    {
      profile: RationProfile.EWE,
      purposes: [MAINTENANCE, BREEDING, FATTENING],
      states: [NORMAL, PREGNANT, LACTATING],
      fields: BASE_FIELDS,
    },
    {
      profile: RationProfile.OTHER,
      purposes: [FATTENING, MAINTENANCE, MILK, BREEDING],
      states: [NORMAL, PREGNANT, LACTATING, DRY],
      fields: MILK_FIELDS,
    },
  ].map(freeze),
);

const BY_PROFILE = new Map(RATION_PROFILES.map((c) => [c.profile, c]));

export function rationProfileConfig(
  profile: RationProfile,
): RationProfileConfig {
  const config = BY_PROFILE.get(profile);
  if (!config) throw new Error(`Unknown ration profile: ${profile}`);
  return config;
}

export interface RationParameters {
  purpose: FeedingPurpose;
  physiologicalState: PhysiologicalState | null;
  milkYieldLiters: string | null;
}

export type RationParameterViolation =
  'purpose' | 'physiologicalState' | 'milkYieldLiters';

/**
 * The first parameter the animal type's profile does not allow (checked in
 * this order: purpose, physiologicalState, milkYieldLiters), or null.
 */
export function findParameterViolation(
  profile: RationProfile,
  params: RationParameters,
): RationParameterViolation | null {
  const config = rationProfileConfig(profile);
  if (!config.purposes.includes(params.purpose)) return 'purpose';
  if (
    params.physiologicalState !== null &&
    !config.states.includes(params.physiologicalState)
  ) {
    return 'physiologicalState';
  }
  if (
    params.milkYieldLiters !== null &&
    !config.fields.includes('milkYieldLiters')
  ) {
    return 'milkYieldLiters';
  }
  return null;
}
