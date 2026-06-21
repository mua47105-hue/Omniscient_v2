'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Wraps the app with a stable TanStack Query client.
 * Created as part of the crypto pages task — react-query needs a provider
 * at the root for any `useQuery` call to function.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
