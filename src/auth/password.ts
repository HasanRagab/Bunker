import { err, ok, type Result } from "../core/result";

/**
 * Hash a password with Bun's built-in password hasher.
 * @example
 * ```ts
 * const hash = await hashPassword(password);
 * ```
 */
export async function hashPassword(password: string): Promise<Result<string, Error>> {
  try {
    return ok(await Bun.password.hash(password));
  } catch (cause) {
    return err(asError(cause));
  }
}

/**
 * Verify a candidate password against a stored Bun password hash.
 * @example
 * ```ts
 * const matches = await verifyPassword(password, storedHash);
 * ```
 */
export async function verifyPassword(password: string, hash: string): Promise<Result<boolean, Error>> {
  try {
    return ok(await Bun.password.verify(password, hash));
  } catch (cause) {
    return err(asError(cause));
  }
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
