import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { AppProviders } from "../../app/app-providers";
import { createAppServices } from "../../app/app-services";
import { appRoutes } from "../../app/router";
import { testServer } from "../../test/server";

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

function renderApp(initialPath: string) {
  const services = createAppServices({ apiBaseUrl: BASE_URL });
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialPath],
  });
  render(
    <AppProviders services={services}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { router, services };
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

  it("submits the password unchanged and authenticates only after bootstrap", async () => {
    let authenticated = false;
    const exactPassword = "  Clave con espacios 🔐  ";
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () =>
        authenticated ? HttpResponse.json(SESSION) : authenticationRequired(),
      ),
      http.post(`${BASE_URL}/auth/login`, async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBeNull();
        await expect(request.json()).resolves.toEqual({
          email: "owner@bcm.test",
          password: exactPassword,
        });
        authenticated = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), " owner@bcm.test ");
    await user.type(screen.getByLabelText("Contraseña"), exactPassword);
    await user.keyboard("{Enter}");

    expect(
      await screen.findByRole("heading", { name: "Sesión activa" }),
    ).toBeDefined();
  });

  it("prevents a duplicate login while the first request is pending", async () => {
    let loginRequests = 0;
    let authenticated = false;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () =>
        authenticated ? HttpResponse.json(SESSION) : authenticationRequired(),
      ),
      http.post(`${BASE_URL}/auth/login`, async () => {
        loginRequests += 1;
        await delay(50);
        authenticated = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "owner@bcm.test");
    await user.type(screen.getByLabelText("Contraseña"), "password");
    const submit = screen.getByRole("button", { name: "Iniciar sesión" });
    await user.dblClick(submit);

    expect(
      await screen.findByRole("heading", { name: "Sesión activa" }),
    ).toBeDefined();
    expect(loginRequests).toBe(1);
  });

  it("rejects an invalid email locally without sending credentials", async () => {
    let loginRequests = 0;
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
      http.post(`${BASE_URL}/auth/login`, () => {
        loginRequests += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "invalid email");
    await user.type(screen.getByLabelText("Contraseña"), "password");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("Ingresá un email válido.")).toBeDefined();
    expect(loginRequests).toBe(0);
  });

  it("keeps errors generic and clears only the password after invalid credentials", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
      http.post(`${BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          {
            statusCode: 401,
            code: "INVALID_CREDENTIALS",
            message: "Las credenciales no son válidas.",
            requestId: "request-login",
          },
          { status: 401 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp("/login");
    const email = await screen.findByLabelText<HTMLInputElement>("Email");
    const password = screen.getByLabelText<HTMLInputElement>("Contraseña");

    await user.type(email, "owner@bcm.test");
    await user.type(password, "incorrect password");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(
      await screen.findByText("El email o la contraseña no son correctos."),
    ).toBeDefined();
    expect(email.value).toBe("owner@bcm.test");
    expect(password.value).toBe("");
  });

  it.each(["network", "server"] as const)(
    "keeps login anonymous after a %s failure without a false session bootstrap",
    async (failure) => {
      let sessionRequests = 0;
      testServer.use(
        http.get(`${BASE_URL}/auth/session`, () => {
          sessionRequests += 1;
          return authenticationRequired();
        }),
        http.post(`${BASE_URL}/auth/login`, () =>
          failure === "network"
            ? HttpResponse.error()
            : HttpResponse.json(
                {
                  statusCode: 500,
                  code: "INTERNAL_SERVER_ERROR",
                  message: "No pudimos completar la solicitud.",
                  requestId: "request-login-server",
                },
                { status: 500 },
              ),
        ),
      );
      const user = userEvent.setup();
      const { services } = renderApp("/login");
      const cancelQueries = vi.spyOn(services.queryClient, "cancelQueries");
      const email = await screen.findByLabelText<HTMLInputElement>("Email");
      const password = screen.getByLabelText<HTMLInputElement>("Contraseña");

      await user.type(email, "owner@bcm.test");
      await user.type(password, "password");
      await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

      expect(
        await screen.findByText("No pudimos conectar con el servicio."),
      ).toBeDefined();
      expect(
        screen.getByRole("heading", { name: "Ingresá a tu cuenta" }),
      ).toBeDefined();
      expect(email.value).toBe("owner@bcm.test");
      expect(password.value).toBe("");
      expect(sessionRequests).toBe(1);
      expect(cancelQueries).not.toHaveBeenCalled();
    },
  );

  it.each([
    [400, "INVALID_REQUEST", "Revisá los datos ingresados."],
    [
      403,
      "ORIGIN_VALIDATION_FAILED",
      "No pudimos validar la solicitud. Intentá nuevamente.",
    ],
  ])(
    "maps a %i login response without ending the session",
    async (status, code, message) => {
      testServer.use(
        http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
        http.post(`${BASE_URL}/auth/login`, () =>
          HttpResponse.json(
            {
              statusCode: status,
              code,
              message: "Safe backend message",
              requestId: "request",
            },
            { status },
          ),
        ),
      );
      const user = userEvent.setup();
      renderApp("/login");

      await user.type(await screen.findByLabelText("Email"), "owner@bcm.test");
      const password = screen.getByLabelText<HTMLInputElement>("Contraseña");
      await user.type(password, "password");
      await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

      expect(await screen.findByText(message)).toBeDefined();
      expect(password.value).toBe("");
    },
  );

  it("honors a bounded Retry-After as informational login UX", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
      http.post(`${BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          {
            statusCode: 429,
            code: "TOO_MANY_REQUESTS",
            message: "Demasiados intentos. Intentá nuevamente más tarde.",
            requestId: "request-rate",
          },
          { status: 429, headers: { "Retry-After": "5" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "owner@bcm.test");
    await user.type(screen.getByLabelText("Contraseña"), "password");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(
      await screen.findByText(
        "Demasiados intentos. Intentá nuevamente más tarde.",
      ),
    ).toBeDefined();
    expect(
      screen.getByText(/Podés volver a intentarlo en 5 segundos/),
    ).toBeDefined();
    expect(
      screen
        .getByRole("button", { name: "Iniciar sesión" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Contraseña").value).toBe(
      "",
    );
  });

  it("re-enables login when the informational Retry-After countdown ends", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => authenticationRequired()),
      http.post(`${BASE_URL}/auth/login`, () =>
        HttpResponse.json(
          {
            statusCode: 429,
            code: "TOO_MANY_REQUESTS",
            message: "Demasiados intentos. Intentá nuevamente más tarde.",
            requestId: "request-rate-short",
          },
          { status: 429, headers: { "Retry-After": "1" } },
        ),
      ),
    );
    const user = userEvent.setup();
    renderApp("/login");

    await user.type(await screen.findByLabelText("Email"), "owner@bcm.test");
    await user.type(screen.getByLabelText("Contraseña"), "password");
    const submit = screen.getByRole<HTMLButtonElement>("button", {
      name: "Iniciar sesión",
    });
    await user.click(submit);

    await screen.findByText(/Podés volver a intentarlo en 1 segundos/);
    expect(submit.disabled).toBe(true);
    await waitFor(() => expect(submit.disabled).toBe(false), {
      timeout: 2_000,
    });
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

      renderApp("/");

      expect(
        await screen.findByRole("heading", {
          name: "No pudimos conectar con el servicio.",
        }),
      ).toBeDefined();
      expect(
        screen.queryByRole("heading", { name: "Ingresá a tu cuenta" }),
      ).toBeNull();
    },
  );
});

describe("logout and cache isolation", () => {
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
    const { services } = renderApp("/");

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
    renderApp("/");

    await screen.findByRole("heading", { name: "Sesión activa" });
    await user.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    expect(
      await screen.findByText(
        "No pudimos validar el cierre de sesión. Intentá nuevamente.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("heading", { name: "Sesión activa" }),
    ).toBeDefined();
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
    services.sessionCoordinator.markAuthenticated();
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
