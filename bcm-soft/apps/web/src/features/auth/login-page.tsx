import { type ReactNode, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router";

import { useAppServices } from "../../app/app-services";
import { setupStatusQueryOptions } from "../setup/setup-queries";

import {
  CheckingSession,
  ServiceUnavailable,
} from "./components/session-state";
import { LoginLink } from "./login-link";
import { useSessionQuery } from "./use-session-query";

/** Codes the API appends as `?error=` when it returns from Auth0. */
const LOGIN_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  access_denied:
    "Tu cuenta no tiene acceso a BCM SOFT. Pedile a un administrador que te dé de alta.",
  login_failed: "No pudimos iniciar sesión. Intentá nuevamente.",
  rate_limited:
    "Demasiados intentos. Esperá unos minutos e intentá nuevamente.",
  unavailable:
    "El inicio de sesión no está disponible en este momento. Intentá más tarde.",
});

export function LoginPage(): ReactNode {
  const { setupApi, sessionCoordinator } = useAppServices();
  const session = useSessionQuery();
  const sessionLossSettled = useSyncExternalStore(
    sessionCoordinator.subscribe,
    sessionCoordinator.isSessionLost,
    sessionCoordinator.isSessionLost,
  );
  // An anonymous bootstrap cancels and clears every query; asking for the
  // setup status only after that cleanup keeps it from being cancelled.
  const setupStatus = useQuery({
    ...setupStatusQueryOptions(setupApi),
    enabled: session.data?.status === "anonymous" && sessionLossSettled,
  });
  const [searchParams] = useSearchParams();
  const errorCode = searchParams.get("error");
  const errorMessage =
    errorCode !== null && Object.hasOwn(LOGIN_ERRORS, errorCode)
      ? LOGIN_ERRORS[errorCode]
      : null;

  if (session.isPending) return <CheckingSession />;
  if (session.isError || setupStatus.isError) {
    return (
      <ServiceUnavailable
        retry={() => {
          void session.refetch();
          void setupStatus.refetch();
        }}
      />
    );
  }
  // Until the first Organization exists, nobody can sign in: run setup.
  if (setupStatus.data) return <Navigate to="/setup" replace />;
  if (session.data.status === "authenticated") {
    return <Navigate to="/" replace />;
  }
  if (setupStatus.isPending) return <CheckingSession />;

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-heading">
          <p className="brand">BCM SOFT</p>
          <h1 id="login-title">Ingresá a tu cuenta</h1>
          <p>Administrá tu comercio desde un único lugar.</p>
        </div>
        <div className="login-methods">
          {errorMessage === null ? null : (
            <p className="login-error" role="alert">
              {errorMessage}
            </p>
          )}
          <LoginLink />
        </div>
      </section>
    </main>
  );
}
