import type { SessionService } from "./session-service.js";

export type SessionBootstrapResult =
  | Readonly<{ status: "invalid" }>
  | Readonly<{
      status: "authenticated";
      user: Readonly<{ id: string }>;
    }>;

const INVALID_RESULT: SessionBootstrapResult = Object.freeze({
  status: "invalid",
});

export class SessionBootstrapUseCase {
  constructor(
    private readonly sessions: Pick<SessionService, "validateSession">,
  ) {}

  async execute(rawToken: string | null): Promise<SessionBootstrapResult> {
    if (rawToken === null) return INVALID_RESULT;

    const session = await this.sessions.validateSession(rawToken);
    if (session.status === "invalid") return INVALID_RESULT;

    return Object.freeze({
      status: "authenticated",
      user: Object.freeze({ id: session.userId }),
    });
  }
}
