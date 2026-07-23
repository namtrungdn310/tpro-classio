"use client";

import { ReactNode, useState } from "react";
import axios from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { authQueryKeys } from "@/lib/auth/query-keys";

function shouldRetry(failureCount: number, error: unknown) {
  if (failureCount >= 1) {
    return false;
  }

  if (!axios.isAxiosError(error)) {
    return false;
  }

  if (!error.response) {
    return true;
  }

  return error.response.status >= 500;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function createQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: 10 * 60 * 1000,
        refetchOnMount: false,
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        retry: shouldRetry,
        retryDelay: 500,
        staleTime: 5 * 60 * 1000,
      },
    },
  });

  client.setQueryDefaults(["classes"], {
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
  client.setQueryDefaults(["students"], {
    staleTime: 3 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  client.setQueryDefaults(["fees"], {
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  client.setQueryDefaults(["dashboard"], {
    staleTime: 30 * 1000,
    gcTime: 5 * 60 * 1000,
  });
  client.setQueryDefaults(["reports"], {
    staleTime: 30 * 1000,
    gcTime: 10 * 60 * 1000,
  });
  client.setQueryDefaults(["staff"], {
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
  });
  client.setQueryDefaults(authQueryKeys.users, {
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
  });

  return client;
}
