import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

// Default: an already configured instance. Setup tests override this.
export const testServer = setupServer(
  http.get("http://localhost:3000/api/setup", () =>
    HttpResponse.json({ required: false }),
  ),
);
