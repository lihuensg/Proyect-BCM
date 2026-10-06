import type { ApiClient } from "../../../lib/http/api-client";
import {
  type MembershipPage,
  membershipPageSchema,
  type MembershipRole,
  type ProvisionedMembership,
  provisionedMembershipSchema,
} from "./memberships-contracts";

export class MembershipsApi {
  constructor(private readonly client: ApiClient) {}

  list(after: string | null): Promise<MembershipPage> {
    const query = after === null ? "" : `?after=${encodeURIComponent(after)}`;
    return this.client.requestJson(
      `/organization/memberships${query}`,
      membershipPageSchema,
      { classification: "public" },
    );
  }

  provision(
    input: Readonly<{ email: string; role: MembershipRole }>,
    csrfToken: string,
  ): Promise<ProvisionedMembership> {
    return this.client.requestJson(
      "/organization/memberships",
      provisionedMembershipSchema,
      {
        method: "POST",
        classification: "authenticated-mutation",
        body: input,
        csrfToken,
      },
    );
  }
}
