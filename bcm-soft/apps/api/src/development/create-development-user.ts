import { PrismaClientLifecycle } from "../infrastructure/database/prisma-client-lifecycle.js";
import { generateUuidV7 } from "../infrastructure/identifiers/uuid-v7.js";
import { Argon2PasswordHasher } from "../identity/infrastructure/argon2-password-hasher.js";
import {
  assertDevelopmentDatabaseTarget,
  DevelopmentProvisioningError,
  formatDevelopmentProvisioningResult,
  provisionDevelopmentUser,
} from "./development-user-provisioner.js";

export async function createDevelopmentUser(
  environment: NodeJS.ProcessEnv,
  writeLine: (message: string) => void,
): Promise<void> {
  const databaseTarget = assertDevelopmentDatabaseTarget(environment);

  const email = environment.BCM_DEV_USER_EMAIL;
  const password = environment.BCM_DEV_USER_PASSWORD;
  if (email === undefined || email.length === 0) {
    throw new DevelopmentProvisioningError("BCM_DEV_USER_EMAIL is required.");
  }
  if (password === undefined || password.length === 0) {
    throw new DevelopmentProvisioningError(
      "BCM_DEV_USER_PASSWORD is required.",
    );
  }

  const lifecycle = new PrismaClientLifecycle(databaseTarget.href);
  try {
    const client = await lifecycle.connect();
    const result = await provisionDevelopmentUser({
      client,
      email,
      password,
      passwordHasher: new Argon2PasswordHasher(),
      generateIdentifier: generateUuidV7,
    });
    writeLine(formatDevelopmentProvisioningResult(result));
  } finally {
    await lifecycle.disconnect();
  }
}
