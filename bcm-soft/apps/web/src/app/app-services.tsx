import { QueryClient } from "@tanstack/react-query";
import { createContext, useContext } from "react";

import { publicConfig } from "../config/public-config";
import { AuthApi } from "../features/auth/api/auth-api";
import { ApiClient } from "../lib/http/api-client";

export type AppServices = Readonly<{
  authApi: AuthApi;
  queryClient: QueryClient;
  sessionCoordinator: Readonly<{
    markAuthenticated(): Promise<void>;
    confirmSessionLoss(): Promise<void>;
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
  let sessionLoss: Promise<void> | null = null;
  let sessionLost = false;
  const sessionListeners = new Set<() => void>();

  const setSessionLost = (lost: boolean): void => {
    if (sessionLost === lost) return;
    sessionLost = lost;
    for (const listener of sessionListeners) listener();
  };

  const confirmSessionLoss = (): Promise<void> => {
    if (sessionLoss !== null) return sessionLoss;
    if (sessionLost) return Promise.resolve();

    const transition = (async () => {
      await queryClient.cancelQueries();
      queryClient.clear();
      setSessionLost(true);
    })();
    sessionLoss = transition;
    void transition.then(
      () => {
        if (sessionLoss === transition) sessionLoss = null;
      },
      () => {
        if (sessionLoss === transition) sessionLoss = null;
      },
    );
    return sessionLoss;
  };

  const apiClient = new ApiClient({
    baseUrl: options.apiBaseUrl ?? publicConfig.apiBaseUrl,
    ...(options.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: options.fetchImplementation }),
    onAuthenticationRequired: confirmSessionLoss,
  });

  return Object.freeze({
    authApi: new AuthApi(apiClient),
    queryClient,
    sessionCoordinator: Object.freeze({
      async markAuthenticated() {
        await sessionLoss;
        setSessionLost(false);
      },
      confirmSessionLoss,
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
