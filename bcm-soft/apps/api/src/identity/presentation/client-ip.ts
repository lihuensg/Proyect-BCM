import { isIP } from "node:net";

function canonicalIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => Number(part));
  if (
    numbers.some(
      (part, index) =>
        !Number.isInteger(part) ||
        part < 0 ||
        part > 255 ||
        String(part) !== parts[index],
    )
  ) {
    return null;
  }
  return numbers.join(".");
}

export function canonicalizeClientIp(
  remoteAddress: string | undefined,
): string | null {
  if (remoteAddress === undefined) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(remoteAddress)?.[1];
  if (mapped !== undefined) return canonicalIpv4(mapped);
  if (isIP(remoteAddress) === 4) return canonicalIpv4(remoteAddress);
  if (isIP(remoteAddress) !== 6) return null;
  const hostname = new URL(`http://[${remoteAddress}]/`).hostname;
  return hostname.slice(1, -1).toLowerCase();
}
