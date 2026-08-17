import { PrismaPg } from "@prisma/adapter-pg";
import type { PoolConfig } from "pg";

import { PrismaClient } from "../../generated/prisma/client.js";
import { assertSafeRuntimeDatabaseIdentity } from "./runtime-database-identity.js";

export class PrismaClientLifecycle {
  readonly #client: PrismaClient;
  readonly #expectedCurrentUser: string;
  #connected = false;

  constructor(
    runtimeDatabaseUrl: string,
    poolConfiguration: Pick<PoolConfig, "max"> = {},
  ) {
    this.#expectedCurrentUser = decodeURIComponent(
      new URL(runtimeDatabaseUrl).username,
    );
    const adapter = new PrismaPg({
      connectionString: runtimeDatabaseUrl,
      ...poolConfiguration,
    });
    this.#client = new PrismaClient({ adapter });
  }

  get client(): PrismaClient {
    return this.#client;
  }

  get connected(): boolean {
    return this.#connected;
  }

  async connect(): Promise<PrismaClient> {
    if (!this.#connected) {
      try {
        await this.#client.$connect();
        await assertSafeRuntimeDatabaseIdentity(
          this.#client,
          this.#expectedCurrentUser,
        );
        this.#connected = true;
      } catch (error: unknown) {
        await this.#client.$disconnect();
        throw error;
      }
    }

    return this.#client;
  }

  async disconnect(): Promise<void> {
    if (!this.#connected) {
      return;
    }

    await this.#client.$disconnect();
    this.#connected = false;
  }
}
