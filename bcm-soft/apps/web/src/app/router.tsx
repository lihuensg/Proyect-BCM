import { createBrowserRouter } from "react-router";

import { RouteErrorBoundary } from "./app-error-boundary";
import { AppShell } from "./app-shell";
import { FoundationPage } from "./foundation-page";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: AppShell,
    ErrorBoundary: RouteErrorBoundary,
    children: [
      {
        index: true,
        Component: FoundationPage,
      },
    ],
  },
]);
