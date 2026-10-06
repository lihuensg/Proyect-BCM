import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it } from "vitest";

import { AppProviders } from "../../app/app-providers";
import { createAppServices } from "../../app/app-services";
import { appRoutes } from "../../app/router";
import { testServer } from "../../test/server";

const BASE_URL = "http://localhost:3000/api";
const SESSION = {
  authenticated: true,
  user: { id: "019c8f52-97d3-7000-8000-000000000001" },
  csrfToken: `v1.${"A".repeat(43)}`,
} as const;
const OWNER = {
  id: "019c8f52-97d3-7000-8000-0000000000a1",
  userId: SESSION.user.id,
  email: "owner@bcm.test",
  role: "Owner",
  status: "Active",
  createdAt: "2026-10-01T12:00:00.000Z",
} as const;

function renderMembersPage(): void {
  const services = createAppServices({ apiBaseUrl: BASE_URL });
  const router = createMemoryRouter(appRoutes, {
    initialEntries: ["/usuarios"],
  });
  render(
    <AppProviders services={services}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

function apiError(status: number, code: string) {
  return HttpResponse.json(
    { statusCode: status, code, message: "Mensaje del servidor." },
    { status },
  );
}

describe("members page", () => {
  it("lists the Organization's members and loads the next page", async () => {
    const viewer = {
      ...OWNER,
      id: "019c8f52-97d3-7000-8000-0000000000a2",
      userId: "019c8f52-97d3-7000-8000-000000000002",
      email: "viewer@bcm.test",
      role: "Viewer",
    };
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => HttpResponse.json(SESSION)),
      http.get(`${BASE_URL}/organization/memberships`, ({ request }) => {
        const after = new URL(request.url).searchParams.get("after");
        return HttpResponse.json(
          after === null
            ? { items: [OWNER], nextCursor: OWNER.id }
            : { items: [viewer], nextCursor: null },
        );
      }),
    );
    const user = userEvent.setup();
    renderMembersPage();

    const table = await screen.findByRole("table", {
      name: "Usuarios de la organización",
    });
    expect(within(table).getByText("owner@bcm.test")).toBeDefined();
    expect(within(table).getByText("Dueño")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Cargar más" }));

    expect(await within(table).findByText("viewer@bcm.test")).toBeDefined();
    expect(within(table).getByText("Solo lectura")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("provisions a member with the session CSRF token and refreshes the list", async () => {
    let members: unknown[] = [OWNER];
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => HttpResponse.json(SESSION)),
      http.get(`${BASE_URL}/organization/memberships`, () =>
        HttpResponse.json({ items: members, nextCursor: null }),
      ),
      http.post(`${BASE_URL}/organization/memberships`, async ({ request }) => {
        expect(request.headers.get("x-csrf-token")).toBe(SESSION.csrfToken);
        await expect(request.json()).resolves.toEqual({
          email: "nuevo@bcm.test",
          role: "Viewer",
        });
        const created = {
          ...OWNER,
          id: "019c8f52-97d3-7000-8000-0000000000a3",
          userId: "019c8f52-97d3-7000-8000-000000000003",
          email: "nuevo@bcm.test",
          role: "Viewer",
        };
        members = [OWNER, created];
        return HttpResponse.json(
          { ...created, passwordSetupEmail: "sent" },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    renderMembersPage();

    await user.type(await screen.findByLabelText("Email"), "nuevo@bcm.test");
    await user.selectOptions(screen.getByLabelText("Rol"), "Viewer");
    await user.click(screen.getByRole("button", { name: "Dar de alta" }));

    expect(
      await screen.findByText(
        "nuevo@bcm.test quedó dado de alta como Solo lectura. Le enviamos un email para que elija su contraseña.",
      ),
    ).toBeDefined();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    const table = screen.getByRole("table");
    expect(await within(table).findByText("nuevo@bcm.test")).toBeDefined();
  });

  it.each([
    ["MEMBERSHIP_EXISTS", 409, "Ese email ya es miembro de la organización."],
    ["ROLE_NOT_ALLOWED", 403, "No tenés permiso para asignar ese rol."],
    [
      "PROVISIONING_CONFLICT",
      409,
      "No se puede dar de alta este email. Contactá a soporte.",
    ],
    [
      "IDENTITY_PROVIDER_UNAVAILABLE",
      503,
      "No pudimos comunicarnos con el servicio de identidad. Intentá nuevamente.",
    ],
    [
      "UNEXPECTED",
      500,
      "No pudimos dar de alta al usuario. Intentá nuevamente.",
    ],
  ])(
    "explains a %s rejection and keeps the typed email",
    async (code, status, message) => {
      testServer.use(
        http.get(`${BASE_URL}/auth/session`, () => HttpResponse.json(SESSION)),
        http.get(`${BASE_URL}/organization/memberships`, () =>
          HttpResponse.json({ items: [OWNER], nextCursor: null }),
        ),
        http.post(`${BASE_URL}/organization/memberships`, () =>
          apiError(status, code),
        ),
      );
      const user = userEvent.setup();
      renderMembersPage();

      await user.type(await screen.findByLabelText("Email"), "otro@bcm.test");
      await user.click(screen.getByRole("button", { name: "Dar de alta" }));

      expect((await screen.findByRole("alert")).textContent).toBe(message);
      expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
        "otro@bcm.test",
      );
    },
  );

  it("tells a member without permission that the list is restricted", async () => {
    testServer.use(
      http.get(`${BASE_URL}/auth/session`, () => HttpResponse.json(SESSION)),
      http.get(`${BASE_URL}/organization/memberships`, () =>
        apiError(403, "AUTHORIZATION_DENIED"),
      ),
    );

    renderMembersPage();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No tenés permiso para ver los usuarios de la organización.",
    );
  });
});
