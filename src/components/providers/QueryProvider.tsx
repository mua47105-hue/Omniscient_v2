'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * QueryClientProvider wrapper. The QueryClient is created lazily so it survives
 * React 19 StrictMode double-mount in development without flushing the cache.
 */
export function QueryProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
