import { createHmac } from "node:crypto";

const PURPOSES = {
  Identity: "bcm-soft/rate-limit/login/identity/v1",
  Network: "bcm-soft/rate-limit/login/network/v1",
  IdentityNetwork: "bcm-soft/rate-limit/login/identity-network/v1",
  ReauthenticationIdentity: "bcm-soft/rate-limit/session-renewal/identity/v1",
  ReauthenticationIdentityNetwork:
    "bcm-soft/rate-limit/session-renewal/identity-network/v1",
} as const;

function frame(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

export class NodeRateLimitFingerprint {
  constructor(private readonly key: Buffer) {}

  identity(normalizedEmail: string): Buffer {
    return this.digest(PURPOSES.Identity, Buffer.from(normalizedEmail, "utf8"));
  }

  network(clientIp: string): Buffer {
    return this.digest(PURPOSES.Network, Buffer.from(clientIp, "utf8"));
  }

  identityNetwork(normalizedEmail: string, clientIp: string): Buffer {
    return this.digest(
      PURPOSES.IdentityNetwork,
      Buffer.concat([frame(normalizedEmail), frame(clientIp)]),
    );
  }

  private digest(purpose: string, input: Buffer): Buffer {
    return createHmac("sha256", this.key)
      .update(purpose, "utf8")
      .update(Buffer.of(0))
      .update(input)
      .digest();
  }

  reauthenticationIdentity(userId: string): Buffer {
    return this.digest(
      PURPOSES.ReauthenticationIdentity,
      Buffer.from(userId, "utf8"),
    );
  }

  reauthenticationIdentityNetwork(userId: string, clientIp: string): Buffer {
    return this.digest(
      PURPOSES.ReauthenticationIdentityNetwork,
      Buffer.concat([frame(userId), frame(clientIp)]),
    );
  }
}
