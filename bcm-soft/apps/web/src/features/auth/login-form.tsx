import { useMutation } from "@tanstack/react-query";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAppServices } from "../../app/app-services";
import { ApiContractError, ApiError } from "../../lib/http/api-error";
import { authKeys, sessionQueryOptions } from "./auth-queries";

const EMAIL_MAX_CODE_POINTS = 254;

function validateEmail(value: string): string | null {
  const email = value.trim();
  if (email.length === 0) return "Ingresá tu email.";
  if ([...email].length > EMAIL_MAX_CODE_POINTS) {
    return "El email es demasiado largo.";
  }
  const separator = email.indexOf("@");
  if (
    separator <= 0 ||
    separator !== email.lastIndexOf("@") ||
    separator === email.length - 1 ||
    /\s/u.test(email)
  ) {
    return "Ingresá un email válido.";
  }
  return null;
}

function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "No pudimos conectar con el servicio.";
  }
  switch (error.code) {
    case "INVALID_REQUEST":
      return "Revisá los datos ingresados.";
    case "INVALID_CREDENTIALS":
      return "El email o la contraseña no son correctos.";
    case "ORIGIN_VALIDATION_FAILED":
    case "CSRF_VALIDATION_FAILED":
      return "No pudimos validar la solicitud. Intentá nuevamente.";
    case "TOO_MANY_REQUESTS":
      return error.message;
    default:
      return "No pudimos conectar con el servicio.";
  }
}

export function LoginForm(): ReactNode {
  const { authApi, queryClient, sessionCoordinator } = useAppServices();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  const retrySeconds =
    retryUntil === null ? 0 : Math.max(0, Math.ceil((retryUntil - now) / 1000));

  useEffect(() => {
    if (retrySeconds === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retrySeconds]);

  const login = useMutation({
    mutationFn: async (
      input: Readonly<{ email: string; password: string }>,
    ) => {
      await authApi.login(input);
      queryClient.removeQueries({ queryKey: authKeys.session });
      const result = await queryClient.fetchQuery({
        ...sessionQueryOptions(authApi),
        staleTime: 0,
      });
      if (result.status !== "authenticated") {
        throw new ApiContractError("Login did not establish a valid session.");
      }
      return result;
    },
    async onSuccess() {
      setPassword("");
      await sessionCoordinator.markAuthenticated();
      void navigate("/", { replace: true });
    },
    onError(error) {
      setPassword("");
      setFormError(loginErrorMessage(error));
      if (error instanceof ApiError && error.retryAfterSeconds !== undefined) {
        const currentTime = Date.now();
        setNow(currentTime);
        setRetryUntil(currentTime + error.retryAfterSeconds * 1000);
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (login.isPending || retrySeconds > 0) return;

    const validationError = validateEmail(email);
    setEmailError(validationError);
    setFormError(null);
    if (validationError !== null) return;

    login.mutate({ email: email.trim(), password });
  }

  return (
    <form className="login-form" noValidate onSubmit={submit}>
      <div className="form-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          aria-describedby={emailError === null ? undefined : "email-error"}
          aria-invalid={emailError !== null}
          onChange={(event) => setEmail(event.currentTarget.value)}
        />
        {emailError === null ? null : (
          <p className="field-error" id="email-error">
            {emailError}
          </p>
        )}
      </div>

      <div className="form-field">
        <label htmlFor="password">Contraseña</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
      </div>

      <div className="form-feedback" aria-live="polite">
        {formError === null ? null : <p role="alert">{formError}</p>}
        {retrySeconds > 0 ? (
          <p>Podés volver a intentarlo en {retrySeconds} segundos.</p>
        ) : null}
      </div>

      <button
        className="primary-button"
        type="submit"
        disabled={login.isPending || retrySeconds > 0}
        aria-busy={login.isPending}
      >
        {login.isPending ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
    </form>
  );
}
