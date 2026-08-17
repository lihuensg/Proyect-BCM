export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, candidatePassword: string): Promise<boolean>;
  needsRehash(passwordHash: string): boolean;
}
