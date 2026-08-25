export type PublicConfig = Readonly<{ apiBaseUrl: string }>;

type PublicEnvironment = Readonly<{
  MODE?: string;
  VITE_API_BASE_URL?: string;
}>;

function configurationError(reason: string): never {
  throw new Error(`Invalid public configuration: VITE_API_BASE_URL ${reason}.`);
}

export function loadPublicConfig(environment: PublicEnvironment): PublicConfig {
  const configuredValue = environment.VITE_API_BASE_URL;
  const value =
    configuredValue === undefined || configuredValue.length === 0
      ? environment.MODE === "test"
        ? "http://localhost:3000/api"
        : configurationError("is required")
      : configuredValue;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return configurationError("must be an absolute URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return configurationError("must use HTTP or HTTPS");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    return configurationError("must not contain embedded credentials");
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return configurationError("must not contain a query or fragment");
  }

  const normalizedPath = url.pathname.replace(/\/+$/u, "");
  const apiBaseUrl = `${url.origin}${normalizedPath}`;

  return Object.freeze({ apiBaseUrl });
}

/** `VITE_*` values are public and embedded in the browser bundle. */
export const publicConfig = loadPublicConfig(import.meta.env);
