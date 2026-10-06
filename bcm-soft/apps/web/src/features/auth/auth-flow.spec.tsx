import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../app/app-providers";
import { createAppServices } from "../../app/app-services";
import { appRoutes } from "../../app/router";
import { testServer } from "../../test/server";
import { authKeys } from "./auth-queries";

const BASE_URL = "http://localhost:3000/api";
const USER_ID = "019c8f52-97d3-7000-8000-000000000001";
const SESSION = {
  authenticated: true,
  user: { id: USER_ID },
  csrfToken: `v1.${"A".repeat(43)}`,
} as const;

function authenticationRequired() {
  return HttpResponse.json(
    {
      statusCode: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Se requiere una sesión válida.",
      requestId: "request-session",
    },
    { status: 401 },
  );
}

function renderApp(
  initialPath: string,
  prepareServices?: (services: ReturnType<typeof createAppServices>) => void,
) {
  const navigateAway = vi.fn<(url: string) => void>();
  const services = createAppServices({ apiBaseUrl: BASE_URL, navigateAway });
  prepareServices?.(services);
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialPath],
  });
  render(
    <AppProviders services={services}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, services, navigateAway };
}

describe("authentication bootstrap and login", () => {
  it("shows a neutral checking state without flashing login", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, async () => {
        await delay(50);
        return authenticationRequired();
      }),
    );

    renderApp("/");

    expect(screen.getByText("Comprobando tu sesión…")).toBeDefined();
    expect(
      screen.queryByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
  });

  it("uses confirmed session loss cleanup for an anonymous initial bootstrap", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, async () => {
        await delay(20);
        return authenticationRequired();
      }),
    );
    const { services } = renderApp("/", (appServices) => {
      appServices.queryClient.setQueryData(["private", "pre-bootstrap"], {
        value: "must-clear",
      });
    });
    const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");

    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
    await waitFor(() => {
      expect(
        services.queryClient.getQueryData(["private", "pre-bootstrap"]),
      ).toBeUndefined();
    });
    expect(cancelQueries).toHaveBeenCalledTimes(1);
  });

  it("starts login as a navigation to the API's Auth0 endpoint", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
    );

    renderApp("/login");

    const link = await screen.findByRole("link", { name: "Iniciar sesión" });
    expect(link.getAttribute("href")).toBe(`${BASE_URL}/auth/auth0/start`);
    expect(screen.queryByLabelText("Contraseña")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [
      "access_denied",
      "Tu cuenta no tiene acceso a BCM SOFT. Pedile a un administrador que te dé de alta.",
    ],
    ["login_failed", "No pudimos iniciar sesión. Intentá nuevamente."],
    [
      "rate_limited",
      "Demasiados intentos. Esperá unos minutos e intentá nuevamente.",
    ],
    [
      "unavailable",
      "El inicio de sesión no está disponible en este momento. Intentá más tarde.",
    ],
  ])("explains the %s return from Auth0", async (code, message) => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
    );

    renderApp(`/login?error=${code}`);

    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("ignores unknown or inherited error codes", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
    );

    renderApp("/login?error=toString");

    await screen.findByRole("link", { name: "Iniciar sesión" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("treats invalid session JSON as unavailable and supports retry", async () => {
    let valid = false;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () =>
        valid
          ? authenticationRequired()
          : HttpResponse.json({ authenticated: false }),
      ),
    );
    const user = userEvent.setup();
    renderApp("/");

    expect(
      await screen.findByRole("heading", {
        name: "No pudimos conectar con el servicio.",
      }),
    ).toBeDefined();
    valid = true;
    await user.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
  });

  it.each(["network", "server"] as const)(
    "keeps a %s bootstrap failure unavailable instead of anonymous",
    async (failure) => {
      testServer.use(
        http.get(`${BASE_URL}/auth/session`, () =>
          failure === "network"
            ? HttpResponse.error()
            : HttpResponse.json(
                {
                  statusCode: 500,
                  code: "INTERNAL_SERVER_ERROR",
                  message: "No pudimos completar la solicitud.",
                },
                { status: 500 },
              ),
        ),
      );

      const { services } = renderApp("/", (appServices) => {
        appServices.queryClient.setQueryData(["private", failure], {
          value: "preserved",
        });
      });

      expect(
        await screen.findByRole("heading", {
          name: "No pudimos conectar con el servicio.",
        }),
      ).toBeDefined();
      expect(
        screen.queryByRole("heading", { name: "Ingresá a tu cuenta" }),
      ).toBeNull();
      expect(services.queryClient.getQueryData(["private", failure])).toEqual({
        value: "preserved",
      });
    },
  );
});

describe("logout and cache isolation", () => {
  it("clears User A data and returns to login after a session refetch loses User A", async () => {
    let identity: "user-a" | "anonymous" = "user-a";
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () =>
        identity === "anonymous"
          ? authenticationRequired()
          : HttpResponse.json(SESSION),
      ),
    );
    const { router, services } = renderApp("/");

    await screen.findByRole("heading", { name: "Sesión activa" });
    const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");
    services.queryClient.setQueryData(["org", "org-a", "private-resource"], {
      secret: "user-a-data",
    });
    identity = "anonymous";
    await act(async () => {
      await services.queryClient.refetchQueries({
        queryKey: authKeys.session,
      });
    });

    // User B then signs in through Auth0, a full page load with a new cache.
    await screen.findByRole("heading", { name: "Ingresá a tu cuenta" });
    expect(router.state.location.pathname).toBe("/login");
    await waitFor(() => {
      expect(
        services.queryClient.getQueryData(["org", "org-a", "private-resource"]),
      ).toBeUndefined();
    });
    expect(cancelQueries).toHaveBeenCalledTimes(1);
  });

  it("sends CSRF, clears every cached user value, and returns to login", async () => {
    let authenticated = true;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () =>
        authenticated ? HttpResponse.json(SESSION) : authenticationRequired(),
      ),
      http.post(`${BASE_URL}/auth/logout`, ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe(SESSION.csrfToken);
        authenticated = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    const { services, navigateAway } = renderApp("/");

    await screen.findByRole("heading", { name: "Sesión activa" });
    services.queryClient.setQueryData(["org", "organization-a", "inventory"], {
      secret: "user-a-data",
    });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
    expect(
      services.queryClient.getQueryData(["org", "organization-a", "inventory"]),
    ).toBeUndefined();
    // Only after BCM revoked the Session does the browser end Auth0's SSO.
    expect(navigateAway).toHaveBeenCalledExactlyOnceWith(
      `${BASE_URL}/auth/auth0/logout`,
    );
  });

  it("keeps the session and refreshes CSRF once after a CSRF 403 without replay", async () => {
    let sessionRequests = 0;
    let logoutRequests = 0;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => {
        sessionRequests += 1;
        return HttpResponse.json({
          ...SESSION,
          csrfToken: `v1.${(sessionRequests === 1 ? "A" : "B").repeat(43)}`,
        });
      }),
      http.post(`${BASE_URL}/auth/logout`, () => {
        logoutRequests += 1;
        return HttpResponse.json(
          {
            statusCode: 403,
            code: "CSRF_VALIDATION_FAILED",
            message: "La validación de seguridad falló.",
            requestId: "request-csrf",
          },
          { status: 403 },
        );
      }),
    );
    const user = userEvent.setup();
    const { services } = renderApp("/");

    await screen.findByRole("heading", { name: "Sesión activa" });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByText(
        "No pudimos validar el cierre de sesión. Intentá nuevamente.",
      ),
    ).toBeDefined();
    await waitFor(() => expect(sessionRequests).toBe(2));
    expect(logoutRequests).toBe(1);
    expect(services.queryClient.getQueryData(["auth", "session"])).toEqual({
      status: "authenticated",
      session: {
        ...SESSION,
        csrfToken: `v1.${"B".repeat(43)}`,
      },
    });
    expect(
      screen.getByRole("heading", { name: "Sesión activa" }),
    ).toBeDefined();
  });

  it.each(["network", "server"] as const)(
    "does not claim logout success after a %s failure",
    async (failure) => {
      testServer.use(
        http.get(`${BASE_URL}/auth/session`, () => HttpResponse.json(SESSION)),
        http.post(`${BASE_URL}/auth/logout`, () =>
          failure === "network"
            ? HttpResponse.error()
            : HttpResponse.json(
                {
                  statusCode: 500,
                  code: "INTERNAL_SERVER_ERROR",
                  message: "No pudimos completar la solicitud.",
                  requestId: "request-logout-server",
                },
                { status: 500 },
              ),
        ),
      );
      const user = userEvent.setup();
      const { router, services } = renderApp("/");

      await screen.findByRole("heading", { name: "Sesión activa" });
      services.queryClient.setQueryData(["private", "user-a"], {
        value: "preserved",
      });
      await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

      expect(
        await screen.findByText("No pudimos cerrar la sesión."),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeDefined();
      expect(
        screen.getByRole("heading", { name: "Sesión activa" }),
      ).toBeDefined();
      expect(router.state.location.pathname).toBe("/");
      expect(services.queryClient.getQueryData(["private", "user-a"])).toEqual({
        value: "preserved",
      });
      expect(services.queryClient.getQueryData(["auth", "session"])).toEqual({
        status: "authenticated",
        session: SESSION,
      });
    },
  );

  it("keeps the session after an Origin 403", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => HttpResponse.json(SESSION)),
      http.post(`${BASE_URL}/auth/logout`, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            code: "ORIGIN_VALIDATION_FAILED",
            message: "La validación de origen falló.",
            requestId: "request-origin",
          },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { services } = renderApp("/");

    await screen.findByRole("heading", { name: "Sesión activa" });
    services.queryClient.setQueryData(["private", "origin-403"], {
      value: "preserved",
    });
    const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByText(
        "No pudimos validar el cierre de sesión. Intentá nuevamente.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Sesión activa" }),
    ).toBeDefined();
    expect(
      services.queryClient.getQueryData(["private", "origin-403"]),
    ).toEqual({ value: "preserved" });
    expect(cancelQueries).not.toHaveBeenCalled();
  });

  it("clears all authenticated state when CSRF recovery finds no session", async () => {
    let sessionRequests = 0;
    let logoutRequests = 0;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => {
        sessionRequests += 1;
        return sessionRequests === 1
          ? HttpResponse.json(SESSION)
          : authenticationRequired();
      }),
      http.post(`${BASE_URL}/auth/logout`, () => {
        logoutRequests += 1;
        return HttpResponse.json(
          {
            statusCode: 403,
            code: "CSRF_VALIDATION_FAILED",
            message: "La validación de seguridad falló.",
            requestId: "request-csrf-expired",
          },
          { status: 403 },
        );
      }),
    );
    const user = userEvent.setup();
    const { services } = renderApp("/");

    await screen.findByRole("heading", { name: "Sesión activa" });
    const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");
    services.queryClient.setQueryData(["private", "user-a"], {
      value: "must-clear",
    });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
    expect(sessionRequests).toBe(3);
    expect(logoutRequests).toBe(1);
    expect(
      services.queryClient.getQueryData(["private", "user-a"]),
    ).toBeUndefined();
    expect(cancelQueries).toHaveBeenCalledTimes(1);
  });

  it.each(["network", "server"] as const)(
    "keeps the session recoverable when CSRF refresh has a %s failure",
    async (failure) => {
      let sessionRequests = 0;
      let logoutRequests = 0;
      testServer.use(
        http.get(`${BASE_URL}/auth/session`, () => {
          sessionRequests += 1;
          if (sessionRequests === 1) return HttpResponse.json(SESSION);
          return failure === "network"
            ? HttpResponse.error()
            : HttpResponse.json(
                {
                  statusCode: 500,
                  code: "INTERNAL_SERVER_ERROR",
                  message: "No pudimos completar la solicitud.",
                  requestId: "request-csrf-recovery",
                },
                { status: 500 },
              );
        }),
        http.post(`${BASE_URL}/auth/logout`, () => {
          logoutRequests += 1;
          return HttpResponse.json(
            {
              statusCode: 403,
              code: "CSRF_VALIDATION_FAILED",
              message: "La validación de seguridad falló.",
              requestId: "request-csrf",
            },
            { status: 403 },
          );
        }),
      );
      const user = userEvent.setup();
      const { router, services } = renderApp("/");

      await screen.findByRole("heading", { name: "Sesión activa" });
      await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

      expect(
        await screen.findByRole("heading", {
          name: "No pudimos conectar con el servicio.",
        }),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: "Reintentar" })).toBeDefined();
      await waitFor(() => expect(sessionRequests).toBe(2));
      expect(logoutRequests).toBe(1);
      expect(router.state.location.pathname).toBe("/");
      expect(services.queryClient.getQueryData(["auth", "session"])).toEqual({
        status: "authenticated",
        session: SESSION,
      });
    },
  );

  it("redirects once after an authenticated request confirms session loss", async () => {
    let authenticated = true;
    let sessionRequests = 0;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => {
        sessionRequests += 1;
        return authenticated
          ? HttpResponse.json(SESSION)
          : authenticationRequired();
      }),
      http.post(`${BASE_URL}/auth/logout`, () => {
        authenticated = false;
        return authenticationRequired();
      }),
    );
    const user = userEvent.setup();
    const { router, services } = renderApp("/");
    const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");

    await screen.findByRole("heading", { name: "Sesión activa" });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe("/login");
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(sessionRequests).toBe(2);
  });

  it("deduplicates global session loss and clears User A cache", async () => {
    testServer.use(
      http.post(`${BASE_URL}/auth/logout`, async () => {
        await delay(20);
        return HttpResponse.json(
          {
            statusCode: 401,
            code: "AUTHENTICATION_REQUIRED",
            message: "Se requiere una sesión válida.",
            requestId: "request-expired",
          },
          { status: 401 },
        );
      }),
    );
    const services = createAppServices({ apiBaseUrl: BASE_URL });
    await services.sessionCoordinator.markAuthenticated();
    services.queryClient.setQueryData(["org", "organization-a", "inventory"], {
      secret: "user-a-data",
    });
    const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");

    const results = await Promise.allSettled([
      services.authApi.logout(SESSION.csrfToken),
      services.authApi.logout(SESSION.csrfToken),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(services.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(services.queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});
