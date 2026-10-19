import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const SKIP_GLOBAL_RATE_LIMIT_KEY = 'rateLimit:skipGlobal';

/** Exempts a route from the global per-IP limit. Only for /health. */
export const SkipGlobalRateLimit = (): CustomDecorator<string> =>
  SetMetadata(SKIP_GLOBAL_RATE_LIMIT_KEY, true);
