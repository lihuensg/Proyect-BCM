/**
 * Values exposed through `VITE_*` are embedded in the Web bundle and public.
 * Add an explicitly named, validated property here only when Web has a real
 * public configuration requirement. Secrets never belong in this boundary.
 */
const publicConfigValues = {} as const;

export type PublicConfig = Readonly<typeof publicConfigValues>;

export const publicConfig: PublicConfig = Object.freeze(publicConfigValues);
