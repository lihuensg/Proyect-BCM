import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren, ReactNode } from "react";

import {
  AppServicesContext,
  defaultAppServices,
  type AppServices,
} from "./app-services";

export function AppProviders({
  children,
  services = defaultAppServices,
}: PropsWithChildren<{ services?: AppServices }>): ReactNode {
  return (
    <AppServicesContext.Provider value={services}>
      <QueryClientProvider client={services.queryClient}>
        {children}
      </QueryClientProvider>
    </AppServicesContext.Provider>
  );
}
