export interface SessionTokenService {
  generate(): string;
  digest(rawToken: string): Buffer;
  isValidFormat(rawToken: string): boolean;
}
