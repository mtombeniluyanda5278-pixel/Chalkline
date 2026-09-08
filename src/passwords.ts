import argon2, { type HashOptions } from "argon2";

/**
 * Passwords are hashed, not encrypted.
 * Hashing is one-way: the server can check a guess, it cannot recover the password.
 * A unique salt is included by Argon2 so two identical passwords do not hash the same.
 * Argon2id is memory-hard, which makes GPU/ASIC guessing slower than SHA-256.
 *
 * These parameters are a starting point for a small API. If signup is slow on your
 * machine, do not drop memoryCost without understanding that you are weakening
 * offline-attack resistance.
 */
const ARGON2_OPTIONS: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}
