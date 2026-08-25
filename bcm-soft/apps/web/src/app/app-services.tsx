import { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { publicConfig } from "../config/public-config";
import { AuthApi } from "../features/auth/api/auth-api";
import { ApiClient } from "../lib/http/api-client";

export type AppServices = Readonly<{
  authApi: AuthApi;
  queryClient: QueryClient;
  sessionCoordinator: Readonly<{
    markAuthenticated(): void;
    markAnonymous(): void;
    isSessionLost(): boolean;
    subscribe(listener: () => void): () => void;
  }>;
}>;

export function createAppServices(
  options: Readonly<{
    apiBaseUrl?: string;
    fetchImplementation?: typeof fetch;
  }> = {},
): AppServices {
  const queryClient = new QueryClient();
  let authenticationLoss: Promise<void> | null = null;
  let authenticated = false;
  let sessionLost = false;
  const sessionListeners = new Set<() => void>();

  const setSessionLost = (lost: boolean): void => {
    if (sessionLost === lost) return;
    sessionLost = lost;
    for (const listener of sessionListeners) listener();
  };

  const handleAuthenticationRequired = (): Promise<void> => {
    if (!authenticated) return authenticationLoss ?? Promise.resolve();
    authenticated = false;
    setSessionLost(true);
    authenticationLoss ??= (async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
    })().finally(() => {
      authenticationLoss = null;
    });
    return authenticationLoss;
  };

  const apiClient = new ApiClient({
    baseUrl: options.apiBaseUrl ?? publicConfig.apiBaseUrl,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    onAuthenticationRequired: handleAuthenticationRequired,
  });

  return Object.freeze({
    authApi: new AuthApi(apiClient),
    queryClient,
    sessionCoordinator: Object.freeze({
      markAuthenticated() {
        authenticated = true;
        setSessionLost(false);
      },
      markAnonymous() {
        authenticated = false;
        setSessionLost(true);
      },
      isSessionLost() {
        return sessionLost;
      },
      subscribe(listener: () => void) {
        sessionListeners.add(listener);
        return () => sessionListeners.delete(listener);
      },
    }),
  });
}

export const defaultAppServices = createAppServices();

export const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === null) throw new Error("App services are unavailable.");
  return services;
}
