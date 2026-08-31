export const TENANT_AUTHORITY_RESOLVER = Symbol("TenantAuthorityResolver");
export const TENANT_PERSISTENCE_SCOPE = Symbol("TenantPersistenceScope");

// TEN-001D has no product repository yet. Feature modules extend this boundary
// with tenant-bound repositories when their first real use case is introduced.
export type TenantRuntimeRepositories = Readonly<Record<never, never>>;
