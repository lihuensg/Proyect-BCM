export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, candidatePassword: string): Promise<boolean>;
  isSupportedHash(passwordHash: string): boolean;
  needsRehash(passwordHash: string): boolean;
}
