export interface CsrfTokenService {
  derive(rawSessionToken: string): string;
  verify(rawSessionToken: string, candidate: string): boolean;
}
