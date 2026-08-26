import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Outlet } from "react-router";

import { ApiError } from "../lib/http/api-error";
import { sessionQueryOptions } from "../features/auth/auth-queries";
import { useSessionQuery } from "../features/auth/use-session-query";
import { useAppServices } from "./app-services";

export function AppShell(): ReactNode {
  const { authApi, queryClient, sessionCoordinator } = useAppServices();
  const session = useSessionQuery();

  const logout = useMutation({
    mutationFn: async () => {
      if (session.data?.status !== "authenticated") return;
      await authApi.logout(session.data.session.csrfToken);
    },
    async onSuccess() {
      await sessionCoordinator.confirmSessionLoss();
    },
    onError(error) {
      if (
        error instanceof ApiError &&
        error.code === "CSRF_VALIDATION_FAILED"
      ) {
        void queryClient
          .fetchQuery({
            ...sessionQueryOptions(authApi),
            retry: false,
            staleTime: 0,
          })
          .then(async (recoveredSession) => {
            if (recoveredSession.status !== "anonymous") return;
            await sessionCoordinator.confirmSessionLoss();
          })
          .catch(() => undefined);
      }
    },
  });

  return (
    <div className="app-layout">
      <header className="app-header">
        <strong className="brand">BCM SOFT</strong>
        <button
          className="secondary-button"
          type="button"
          disabled={logout.isPending}
          aria-busy={logout.isPending}
          onClick={() => logout.mutate()}
        >
          {logout.isPending ? "Cerrando sesión…" : "Cerrar sesión"}
        </button>
      </header>
      {logout.isError ? (
        <section className="logout-error" role="alert">
          <p>
            {logout.error instanceof ApiError && logout.error.status === 403
              ? "No pudimos validar el cierre de sesión. Intentá nuevamente."
              : "No pudimos cerrar la sesión."}
          </p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => logout.mutate()}
          >
            Reintentar
          </button>
        </section>
      ) : null}
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
