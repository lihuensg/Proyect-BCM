import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppErrorBoundary } from "./app-error-boundary";

function BrokenPage(): ReactNode {
  throw new Error("Expected render failure for the error boundary test");
}

describe("AppErrorBoundary", () => {
  it("offers a keyboard-reachable recovery action after a render failure", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      render(
        <AppErrorBoundary>
          <BrokenPage />
        </AppErrorBoundary>,
      );

      expect(
        screen.getByRole("heading", { name: "No pudimos mostrar BCM SOFT" }),
      ).toBeDefined();

      const reloadButton = screen.getByRole("button", { name: "Recargar" });
      const user = userEvent.setup();

      await user.tab();

      expect(document.activeElement).toBe(reloadButton);
    } finally {
      consoleError.mockRestore();
    }
  });
});
