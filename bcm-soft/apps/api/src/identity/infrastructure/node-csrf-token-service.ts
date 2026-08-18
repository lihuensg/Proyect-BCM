import { createHmac, timingSafeEqual } from "node:crypto";

import type { CsrfTokenService } from "../application/csrf-token-service.js";

const VERSION = "v1";
const PURPOSE = "bcm-soft/csrf/v1";
const TOKEN_PATTERN = /^v1\.[A-Za-z0-9_-]{43}$/u;

export class NodeCsrfTokenService implements CsrfTokenService {
  constructor(private readonly key: Buffer) {}

  derive(rawSessionToken: string): string {
    const digest = createHmac("sha256", this.key)
      .update(PURPOSE, "utf8")
      .update(Buffer.of(0))
      .update(rawSessionToken, "utf8")
      .digest("base64url");
    return `${VERSION}.${digest}`;
  }

  verify(rawSessionToken: string, candidate: string): boolean {
    if (!TOKEN_PATTERN.test(candidate)) return false;
    const expected = Buffer.from(this.derive(rawSessionToken), "utf8");
    const received = Buffer.from(candidate, "utf8");
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }
}
