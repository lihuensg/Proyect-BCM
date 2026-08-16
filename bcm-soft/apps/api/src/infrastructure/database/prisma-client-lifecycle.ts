import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../generated/prisma/client.js";

export class PrismaClientLifecycle {
  readonly #client: PrismaClient;
  #connected = false;

  constructor(runtimeDatabaseUrl: string) {
    const adapter = new PrismaPg({ connectionString: runtimeDatabaseUrl });
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
      await this.#client.$connect();
      this.#connected = true;
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
