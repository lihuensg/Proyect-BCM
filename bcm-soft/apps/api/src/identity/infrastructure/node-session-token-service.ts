import { createHash, randomBytes } from "node:crypto";

import type { SessionTokenService } from "../application/session-token-service.js";

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PURPOSE = Buffer.from("bcm-soft/session/v1", "utf8");
const PURPOSE_SEPARATOR = Buffer.from([0]);

type RandomBytes = (size: number) => Buffer;

export class NodeSessionTokenService implements SessionTokenService {
  constructor(private readonly randomBytesSource: RandomBytes = randomBytes) {}

  generate(): string {
    return this.randomBytesSource(TOKEN_BYTE_LENGTH).toString("base64url");
  }

  digest(rawToken: string): Buffer {
    return createHash("sha256")
      .update(PURPOSE)
      .update(PURPOSE_SEPARATOR)
      .update(rawToken, "utf8")
      .digest();
  }

  isValidFormat(rawToken: string): boolean {
    return TOKEN_PATTERN.test(rawToken);
  }
}
