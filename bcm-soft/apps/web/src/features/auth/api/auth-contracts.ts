import { z } from "zod";

export const authenticatedSessionSchema = z.strictObject({
  authenticated: z.literal(true),
  user: z.strictObject({ id: z.string().uuid() }),
  csrfToken: z.string().regex(/^v1\.[A-Za-z0-9_-]+$/u),
});

export type AuthenticatedSession = z.infer<typeof authenticatedSessionSchema>;

export type SessionResult =
  | Readonly<{ status: "anonymous" }>
  | Readonly<{
      status: "authenticated";
      session: AuthenticatedSession;
    }>;
