import { randomBytes } from "node:crypto";

import {
  argon2id,
  hash as argon2Hash,
  verify as argon2Verify,
  type HashOptions,
} from "argon2";

import type { PasswordHasher } from "../application/password-hasher.js";
import { assertPasswordPolicy } from "../domain/password-policy.js";

export const ARGON2_PASSWORD_POLICY = Object.freeze({
  algorithm: "argon2id",
  type: argon2id,
  version: 0x13,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  saltLength: 16,
  hashLength: 32,
} as const);

export type Argon2PhcInspection = Readonly<{
  algorithm: "argon2d" | "argon2i" | "argon2id";
  version: number;
  memoryCost: number;
  timeCost: number;
  parallelism: number;
  saltLength: number;
  hashLength: number;
}>;

export type Argon2Driver = Readonly<{
  hash(password: Buffer, options: HashOptions): Promise<string>;
  verify(passwordHash: string, password: Buffer): Promise<boolean>;
}>;

const DEFAULT_ARGON2_DRIVER: Argon2Driver = Object.freeze({
  hash: argon2Hash,
  verify: argon2Verify,
});

const PHC_PATTERN =
  /^\$(argon2d|argon2i|argon2id)\$v=(\d+)\$([^$]+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

export class PasswordHashingError extends Error {
  override readonly name = "PasswordHashingError";

  constructor() {
    super("Password hashing failed.");
  }
}

function parsePositiveInteger(value: string | undefined): number | null {
  if (value === undefined || !/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodePhcBase64(value: string): Buffer | null {
  if (value.length % 4 === 1) {
    return null;
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const decoded = Buffer.from(`${value}${padding}`, "base64");
  const canonical = decoded.toString("base64").replace(/=+$/u, "");

  return canonical === value.replace(/=+$/u, "") ? decoded : null;
}

export function inspectArgon2Phc(
  passwordHash: string,
): Argon2PhcInspection | null {
  const match = PHC_PATTERN.exec(passwordHash);

  if (match === null) {
    return null;
  }

  const [, algorithm, versionValue, rawParameters, saltValue, hashValue] =
    match;
  const parameters = new Map<string, string>();

  for (const parameter of rawParameters?.split(",") ?? []) {
    const [key, value, ...unexpected] = parameter.split("=");

    if (
      key === undefined ||
      value === undefined ||
      unexpected.length > 0 ||
      parameters.has(key)
    ) {
      return null;
    }

    parameters.set(key, value);
  }

  if (
    parameters.size !== 3 ||
    !parameters.has("m") ||
    !parameters.has("t") ||
    !parameters.has("p")
  ) {
    return null;
  }

  const version = parsePositiveInteger(versionValue);
  const memoryCost = parsePositiveInteger(parameters.get("m"));
  const timeCost = parsePositiveInteger(parameters.get("t"));
  const parallelism = parsePositiveInteger(parameters.get("p"));
  const salt = saltValue === undefined ? null : decodePhcBase64(saltValue);
  const digest = hashValue === undefined ? null : decodePhcBase64(hashValue);

  if (
    algorithm === undefined ||
    version === null ||
    memoryCost === null ||
    timeCost === null ||
    parallelism === null ||
    salt === null ||
    digest === null
  ) {
    return null;
  }

  return Object.freeze({
    algorithm: algorithm as Argon2PhcInspection["algorithm"],
    version,
    memoryCost,
    timeCost,
    parallelism,
    saltLength: salt.byteLength,
    hashLength: digest.byteLength,
  });
}

function matchesCurrentPolicy(inspection: Argon2PhcInspection): boolean {
  return (
    inspection.algorithm === ARGON2_PASSWORD_POLICY.algorithm &&
    inspection.version === ARGON2_PASSWORD_POLICY.version &&
    inspection.memoryCost === ARGON2_PASSWORD_POLICY.memoryCost &&
    inspection.timeCost === ARGON2_PASSWORD_POLICY.timeCost &&
    inspection.parallelism === ARGON2_PASSWORD_POLICY.parallelism &&
    inspection.saltLength === ARGON2_PASSWORD_POLICY.saltLength &&
    inspection.hashLength === ARGON2_PASSWORD_POLICY.hashLength
  );
}

export class Argon2PasswordHasher implements PasswordHasher {
  constructor(private readonly driver: Argon2Driver = DEFAULT_ARGON2_DRIVER) {}

  async hash(password: string): Promise<string> {
    assertPasswordPolicy(password);

    try {
      return await this.driver.hash(Buffer.from(password, "utf8"), {
        type: ARGON2_PASSWORD_POLICY.type,
        version: ARGON2_PASSWORD_POLICY.version,
        memoryCost: ARGON2_PASSWORD_POLICY.memoryCost,
        timeCost: ARGON2_PASSWORD_POLICY.timeCost,
        parallelism: ARGON2_PASSWORD_POLICY.parallelism,
        hashLength: ARGON2_PASSWORD_POLICY.hashLength,
        salt: randomBytes(ARGON2_PASSWORD_POLICY.saltLength),
      });
    } catch {
      throw new PasswordHashingError();
    }
  }

  async verify(
    passwordHash: string,
    candidatePassword: string,
  ): Promise<boolean> {
    try {
      assertPasswordPolicy(candidatePassword);
    } catch {
      return false;
    }

    const inspection = inspectArgon2Phc(passwordHash);

    if (inspection?.algorithm !== ARGON2_PASSWORD_POLICY.algorithm) {
      return false;
    }

    try {
      return await this.driver.verify(
        passwordHash,
        Buffer.from(candidatePassword, "utf8"),
      );
    } catch {
      return false;
    }
  }

  isSupportedHash(passwordHash: string): boolean {
    return inspectArgon2Phc(passwordHash)?.algorithm === "argon2id";
  }

  needsRehash(passwordHash: string): boolean {
    const inspection = inspectArgon2Phc(passwordHash);
    return inspection === null || !matchesCurrentPolicy(inspection);
  }
}
