import { z } from "zod";

import type { ApiClient } from "../../../lib/http/api-client";

const setupStatusSchema = z.strictObject({ required: z.boolean() });

const completedSetupSchema = z.strictObject({
  organizationId: z.string().uuid(),
  ownerEmail: z.string(),
  passwordSetupEmail: z.enum(["sent", "failed", "not-required"]),
});

export type CompletedSetup = z.infer<typeof completedSetupSchema>;

export class SetupApi {
  constructor(private readonly client: ApiClient) {}

  async isRequired(): Promise<boolean> {
    const status = await this.client.requestJson("/setup", setupStatusSchema, {
      classification: "public",
    });
    return status.required;
  }

  complete(
    input: Readonly<{
      setupToken: string;
      organizationName: string;
      ownerEmail: string;
    }>,
  ): Promise<CompletedSetup> {
    return this.client.requestJson("/setup", completedSetupSchema, {
      method: "POST",
      classification: "public",
      body: input,
    });
  }
}
