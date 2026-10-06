import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Navigate } from "react-router";

import { useAppServices } from "../../app/app-services";
import { ApiError } from "../../lib/http/api-error";
import {
  CheckingSession,
  ServiceUnavailable,
} from "../auth/components/session-state";
import { LoginLink } from "../auth/login-link";
import type { CompletedSetup } from "./api/setup-api";
import { setupKeys, setupStatusQueryOptions } from "./setup-queries";

const SETUP_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  SETUP_TOKEN_INVALID: "El código de configuración no es válido.",
  INVALID_EMAIL: "El email no es válido.",
  INVALID_ORGANIZATION_NAME: "Ingresá el nombre de la organización.",
  PROVISIONING_CONFLICT: "No se puede usar este email. Contactá a soporte.",
  IDENTITY_PROVIDER_UNAVAILABLE:
    "No pudimos comunicarnos con el servicio de identidad. Intentá nuevamente.",
  SETUP_UNAVAILABLE:
    "La configuración inicial no está habilitada en el servidor (falta SETUP_TOKEN).",
  TOO_MANY_REQUESTS:
    "Demasiados intentos. Esperá unos minutos e intentá nuevamente.",
});

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && Object.hasOwn(SETUP_ERRORS, error.code)) {
    return SETUP_ERRORS[error.code] ?? "";
  }
  return "No pudimos completar la configuración. Intentá nuevamente.";
}

function SetupCompleted({ result }: { result: CompletedSetup }): ReactNode {
  return (
    <section className="login-card" aria-labelledby="setup-done-title">
      <div className="login-heading">
        <p className="brand">BCM SOFT</p>
        <h1 id="setup-done-title">¡Listo!</h1>
        <p>
          {result.passwordSetupEmail === "not-required"
            ? `${result.ownerEmail} ya tenía una cuenta: ingresá con tu contraseña actual.`
            : result.passwordSetupEmail === "sent"
              ? `Te enviamos un email a ${result.ownerEmail} para que elijas tu contraseña. Después, iniciá sesión.`
              : `No pudimos enviarte el email para elegir tu contraseña: al iniciar sesión usá "¿Olvidaste tu contraseña?" con ${result.ownerEmail}.`}
        </p>
      </div>
      <div className="login-methods">
        <LoginLink />
      </div>
    </section>
  );
}

function SetupForm({
  onCompleted,
}: Readonly<{ onCompleted: (result: CompletedSetup) => void }>): ReactNode {
  const { setupApi } = useAppServices();
  const queryClient = useQueryClient();
  const organizationId = useId();
  const emailId = useId();
  const tokenId = useId();
  const [organizationName, setOrganizationName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [setupToken, setSetupToken] = useState("");

  const complete = useMutation({
    mutationFn: () =>
      setupApi.complete({ setupToken, organizationName, ownerEmail }),
    onSuccess(result) {
      onCompleted(result);
      queryClient.setQueryData(setupKeys.status, false);
    },
    onError(error) {
      if (
        error instanceof ApiError &&
        error.code === "SETUP_ALREADY_COMPLETED"
      ) {
        queryClient.setQueryData(setupKeys.status, false);
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!complete.isPending) complete.mutate();
  }

  const incomplete =
    organizationName.trim().length === 0 ||
    ownerEmail.trim().length === 0 ||
    setupToken.length === 0;

  return (
    <section className="login-card" aria-labelledby="setup-title">
      <div className="login-heading">
        <p className="brand">BCM SOFT</p>
        <h1 id="setup-title">Configuración inicial</h1>
        <p>
          Creá tu organización y tu usuario dueño. Este paso se hace una sola
          vez.
        </p>
      </div>
      <form className="setup-form" onSubmit={submit} noValidate>
        <div className="form-field">
          <label htmlFor={organizationId}>Nombre de la organización</label>
          <input
            id={organizationId}
            autoComplete="organization"
            required
            value={organizationName}
            onChange={(event) => setOrganizationName(event.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={emailId}>Tu email</label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={ownerEmail}
            onChange={(event) => setOwnerEmail(event.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={tokenId}>Código de configuración</label>
          <input
            id={tokenId}
            type="password"
            autoComplete="off"
            required
            aria-describedby={`${tokenId}-hint`}
            value={setupToken}
            onChange={(event) => setSetupToken(event.currentTarget.value)}
          />
          <p id={`${tokenId}-hint`} className="field-hint">
            Es el valor de SETUP_TOKEN configurado en el servidor.
          </p>
        </div>
        <div className="form-feedback" aria-live="polite">
          {complete.isError ? (
            <p role="alert">{errorMessage(complete.error)}</p>
          ) : null}
        </div>
        <button
          className="primary-button"
          type="submit"
          disabled={complete.isPending || incomplete}
          aria-busy={complete.isPending}
        >
          {complete.isPending ? "Configurando…" : "Crear organización"}
        </button>
      </form>
    </section>
  );
}

export function SetupPage(): ReactNode {
  const { setupApi } = useAppServices();
  const status = useQuery(setupStatusQueryOptions(setupApi));
  const [completed, setCompleted] = useState<CompletedSetup | null>(null);

  if (completed !== null) {
    return (
      <main className="login-page">
        <SetupCompleted result={completed} />
      </main>
    );
  }
  if (status.isPending) return <CheckingSession />;
  if (status.isError) {
    return <ServiceUnavailable retry={() => void status.refetch()} />;
  }
  // A configured instance never shows the wizard again.
  if (!status.data) return <Navigate to="/login" replace />;

  return (
    <main className="login-page">
      <SetupForm onCompleted={setCompleted} />
    </main>
  );
}
