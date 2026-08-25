import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { testServer } from "./server";

beforeAll(() => {
  testServer.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  testServer.resetHandlers();
});

afterAll(() => {
  testServer.close();
});
