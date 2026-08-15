import type { ReactNode } from "react";
import { Outlet } from "react-router";

export function AppShell(): ReactNode {
  return (
    <>
      <header>
        <strong>BCM SOFT</strong>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
