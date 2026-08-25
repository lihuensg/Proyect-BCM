import { type ReactNode, useSyncExternalStore } from "react";
import { Navigate, Outlet } from "react-router";

import { useAppServices } from "../../../app/app-services";
import { useSessionQuery } from "../use-session-query";

export function CheckingSession(): ReactNode {
  return (
    <main className="status-page" aria-busy="true" aria-live="polite">
      <p>Comprobando tu sesión…</p>
    </main>
  );
}

export function ServiceUnavailable({
  retry,
}: Readonly<{ retry: () => void }>): ReactNode {
  return (
    <main className="status-page">
      <section className="status-card" role="alert">
        <h1>No pudimos conectar con el servicio.</h1>
        <p>Revisá tu conexión o intentá nuevamente en unos instantes.</p>
        <button className="primary-button" type="button" onClick={retry}>
          Reintentar
        </button>
      </section>
    </main>
  );
}

export function AuthenticatedRoute(): ReactNode {
  const { sessionCoordinator } = useAppServices();
  const sessionLost = useSyncExternalStore(
    sessionCoordinator.subscribe,
    sessionCoordinator.isSessionLost,
    sessionCoordinator.isSessionLost,
  );
  const session = useSessionQuery();

  if (sessionLost) return <Navigate to="/login" replace />;
  if (session.isPending) return <CheckingSession />;
  if (session.isError) {
    return <ServiceUnavailable retry={() => void session.refetch()} />;
  }
  if (session.data.status === "anonymous") {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
