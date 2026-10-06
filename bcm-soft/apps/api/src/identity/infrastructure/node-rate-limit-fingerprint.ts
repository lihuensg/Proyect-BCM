import { createHmac } from "node:crypto";

const NETWORK_PURPOSE = "bcm-soft/rate-limit/network/v1";

/** Keyed fingerprint so client IPs are never held in memory in clear. */
export class NodeRateLimitFingerprint {
  constructor(private readonly key: Buffer) {}

  network(clientIp: string): Buffer {
    return createHmac("sha256", this.key)
      .update(NETWORK_PURPOSE, "utf8")
      .update(Buffer.of(0))
      .update(clientIp, "utf8")
      .digest();
  }
}
