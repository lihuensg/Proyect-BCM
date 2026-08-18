import type { IdentityAudit } from "./identity-audit.js";
import type { SessionService } from "./session-service.js";

export class LogoutUseCase {
  constructor(
    private readonly sessions: Pick<SessionService, "revokeSession">,
    private readonly audit: IdentityAudit,
  ) {}

  async execute(rawToken: string | null): Promise<void> {
    if (rawToken !== null) {
      await this.sessions.revokeSession(rawToken);
    }

    this.audit.recordLogout();
  }
}
