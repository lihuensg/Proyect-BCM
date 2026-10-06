export const TENANT_AUTHORITY_RESOLVER = Symbol("TenantAuthorityResolver");
export const TENANT_PERSISTENCE_SCOPE = Symbol("TenantPersistenceScope");

import type { MembershipAdministrationRepositories } from "./application/membership-administration.js";

// Tenant-bound repositories available inside TenantPersistenceScope. Feature
// modules extend this boundary when their first real use case is introduced.
export type TenantRuntimeRepositories = MembershipAdministrationRepositories;
