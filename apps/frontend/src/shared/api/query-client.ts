import { QueryClient } from '@tanstack/react-query';
import { toApiError } from './errors';

const MAX_QUERY_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        // Queries are GETs: only transient failures are retried. 4xx answers
        // are final and shown to the user immediately.
        retry: (failureCount, error) => {
          const apiError = toApiError(error);
          return (apiError.isNetworkError || apiError.isServerError) && failureCount < MAX_QUERY_RETRIES;
        },
      },
      // Mutations are never retried blindly.
      mutations: { retry: false },
    },
  });
}
