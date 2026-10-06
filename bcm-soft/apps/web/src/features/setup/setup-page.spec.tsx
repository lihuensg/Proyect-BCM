import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AppProviders } from "../../app/app-providers";
import { createAppServices } from "../../app/app-services";
import { appRoutes } from "../../app/router";
import { testServer } from "../../test/server";

const BASE_URL = "http://localhost:3000/api";

function anonymous() {
  return HttpResponse.json(
    {
      statusCode: 401,
      code: "AUTHENTICATION_REQUIRED",
      message: "Se requiere una sesión válida.",
    },
    { status: 401 },
  );
}

function renderAt(path: string) {
  const services = createAppServices({ apiBaseUrl: BASE_URL });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <AppProviders services={services}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

async function fillForm(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("Nombre de la organización"),
    "BCM",
  );
  await user.type(screen.getByLabelText("Tu email"), "owner@bcm.test");
  await user.type(screen.getByLabelText("Código de configuración"), "secret");
  return user;
}

describe("initial setup", () => {
  it("sends an unconfigured instance from login to the setup wizard", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => anonymous()),
      http.get(`${BASE_URL}/setup`, () =>
        HttpResponse.json({ required: true }),
      ),
    );

    const router = renderAt("/login");

    expect(
      await screen.findByRole("heading", { name: "Configuración inicial" }),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe("/setup");
  });

  it("reaches the wizard when the setup status answers after the anonymous cleanup", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => anonymous()),
      http.get(`${BASE_URL}/setup`, async () => {
        await delay(50);
        return HttpResponse.json({ required: true });
      }),
    );

    renderAt("/login");

    expect(
      await screen.findByRole("heading", { name: "Configuración inicial" }),
    ).toBeDefined();
  });

  it("creates the Organization and explains the next step", async () => {
    testServer.use(
      http.get(`${BASE_URL}/setup`, () =>
        HttpResponse.json({ required: true }),
      ),
      http.post(`${BASE_URL}/setup`, async ({ request }) => {
        await expect(request.json()).resolves.toEqual({
          setupToken: "secret",
          organizationName: "BCM",
          ownerEmail: "owner@bcm.test",
        });
        return HttpResponse.json(
          {
            organizationId: "019c8f52-97d3-7000-8000-0000000000b1",
            ownerEmail: "owner@bcm.test",
            passwordSetupEmail: "sent",
          },
          { status: 201 },
        );
      }),
    );
    renderAt("/setup");
    const user = await fillForm();

    await user.click(
      screen.getByRole("button", { name: "Crear organización" }),
    );

    expect(
      await screen.findByRole("heading", { name: "¡Listo!" }),
    ).toBeDefined();
    expect(
      screen.getByText(
        "Te enviamos un email a owner@bcm.test para que elijas tu contraseña. Después, iniciá sesión.",
      ),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Iniciar sesión" }).getAttribute("href"),
    ).toBe(`${BASE_URL}/auth/auth0/start`);
  });

  it.each([
    ["SETUP_TOKEN_INVALID", 403, "El código de configuración no es válido."],
    [
      "SETUP_UNAVAILABLE",
      503,
      "La configuración inicial no está habilitada en el servidor (falta SETUP_TOKEN).",
    ],
  ])("explains a %s rejection", async (code, status, message) => {
    testServer.use(
      http.get(`${BASE_URL}/setup`, () =>
        HttpResponse.json({ required: true }),
      ),
      http.post(`${BASE_URL}/setup`, () =>
        HttpResponse.json(
          { statusCode: status, code, message: "x" },
          { status },
        ),
      ),
    );
    renderAt("/setup");
    const user = await fillForm();

    await user.click(
      screen.getByRole("button", { name: "Crear organización" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(message);
  });

  it("never shows the wizard on a configured instance", async () => {
    testServer.use(http.get(`${BASE_URL}/auth/session`, () => anonymous()));

    const router = renderAt("/setup");

    expect(
      await screen.findByRole("heading", { name: "Ingresá a tu cuenta" }),
    ).toBeDefined();
    expect(router.state.location.pathname).toBe("/login");
  });
});
