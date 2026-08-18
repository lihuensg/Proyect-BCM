export type RawHeadersRequest = Readonly<{ rawHeaders: readonly string[] }>;

function values(request: RawHeadersRequest, name: string): string[] {
  const matches: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name) {
      matches.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return matches;
}

export class TrustedOriginValidator {
  readonly #trusted: ReadonlySet<string>;

  constructor(trustedOrigins: readonly string[]) {
    this.#trusted = new Set(trustedOrigins);
  }

  accepts(request: RawHeadersRequest): boolean {
    const origins = values(request, "origin");
    if (origins.length > 1) return false;
    if (origins.length === 1)
      return origins[0] !== "null" && this.#trusted.has(origins[0] ?? "");

    const referers = values(request, "referer");
    if (referers.length !== 1) return false;
    try {
      const referer = new URL(referers[0] ?? "");
      return this.#trusted.has(referer.origin);
    } catch {
      return false;
    }
  }
}

export function readSingleHeader(
  request: RawHeadersRequest,
  name: string,
): string | null {
  const matches = values(request, name.toLowerCase());
  return matches.length === 1 ? (matches[0] ?? null) : null;
}
