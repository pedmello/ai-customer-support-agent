import argon2 from "argon2";
import { randomBytes } from "node:crypto";

// OWASP minimum Argon2id parameters. Random salt is supplied by the library.
export const hashPassword = (password: string) =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
let dummy: Promise<string> | undefined;
export async function verifyPassword(
  stored: string | null,
  password: string,
): Promise<boolean> {
  // Missing/legacy accounts still perform one real password verification.
  dummy ??= hashPassword(randomBytes(32).toString("base64url"));
  const valid = await argon2.verify(stored ?? (await dummy), password);
  return stored !== null && valid;
}
