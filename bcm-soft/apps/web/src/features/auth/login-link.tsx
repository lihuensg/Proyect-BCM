import type { ReactNode } from "react";

import { useAppServices } from "../../app/app-services";

/** A plain navigation: the API runs the Auth0 redirect flow server-side. */
export function LoginLink(): ReactNode {
  const { authApi } = useAppServices();

  return (
    <a className="primary-button login-link" href={authApi.loginUrl()}>
      Iniciar sesión
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 10h12M11 5l5 5-5 5" />
      </svg>
    </a>
  );
}
