import { createBrowserRouter, type RouteObject } from "react-router";

import { RouteErrorBoundary } from "./app-error-boundary";
import { AppShell } from "./app-shell";
import { FoundationPage } from "./foundation-page";
import { AuthenticatedRoute } from "../features/auth/components/session-state";
import { LoginPage } from "../features/auth/login-page";

export const appRoutes: RouteObject[] = [
  {
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        path: "/login",
        Component: LoginPage,
      },
      {
        Component: AuthenticatedRoute,
        children: [
          {
            path: "/",
            Component: AppShell,
            children: [
              {
                index: true,
                Component: FoundationPage,
              },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(appRoutes);
