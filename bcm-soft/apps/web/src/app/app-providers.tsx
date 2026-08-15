import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactNode } from "react";

const queryClient = new QueryClient();

export function AppProviders({ children }: PropsWithChildren): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
