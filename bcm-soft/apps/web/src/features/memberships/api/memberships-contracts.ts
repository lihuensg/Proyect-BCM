import { z } from "zod";

export const MEMBERSHIP_ROLES = ["Owner", "Admin", "Seller", "Viewer"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const membershipSchema = z.strictObject({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string(),
  role: z.enum(MEMBERSHIP_ROLES),
  status: z.enum(["Active", "Suspended", "Revoked"]),
  createdAt: z.string().datetime(),
});

export type Membership = z.infer<typeof membershipSchema>;

export const membershipPageSchema = z.strictObject({
  items: z.array(membershipSchema),
  nextCursor: z.string().uuid().nullable(),
});

export type MembershipPage = z.infer<typeof membershipPageSchema>;

export const provisionedMembershipSchema = membershipSchema.extend({
  passwordSetupEmail: z.enum(["sent", "failed", "not-required"]),
});

export type ProvisionedMembership = z.infer<typeof provisionedMembershipSchema>;
