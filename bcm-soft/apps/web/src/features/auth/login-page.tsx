import type { ReactNode } from "react";
import { Navigate } from "react-router";

import {
  CheckingSession,
  ServiceUnavailable,
} from "./components/session-state";
import { LoginForm } from "./login-form";
import { useSessionQuery } from "./use-session-query";

export function LoginPage(): ReactNode {
  const session = useSessionQuery();

  if (session.isPending) return <CheckingSession />;
  if (session.isError) {
    return <ServiceUnavailable retry={() => void session.refetch()} />;
  }
  if (session.data.status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-heading">
          <p className="brand">BCM SOFT</p>
          <h1 id="login-title">Ingresá a tu cuenta</h1>
          <p>Administrá tu comercio desde un único lugar.</p>
        </div>
        <div className="login-methods">
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
