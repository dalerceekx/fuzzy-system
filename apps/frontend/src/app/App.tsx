import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { createQueryClient } from '@/shared/api/query-client';
import { Toaster } from '@/shared/ui';
import { AuthBootstrap } from './providers/AuthBootstrap';
import { routes } from './router/routes';

const router = createBrowserRouter(routes);

export function App({ queryClient: injected }: { queryClient?: QueryClient }) {
  const [queryClient] = useState(() => injected ?? createQueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap>
        <RouterProvider router={router} />
      </AuthBootstrap>
      <Toaster />
    </QueryClientProvider>
  );
}
