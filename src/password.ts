import { err, ok, type Result } from "./result";

export async function hashPassword(password: string): Promise<Result<string, Error>> {
  try {
    return ok(await Bun.password.hash(password));
  } catch (cause) {
    return err(asError(cause));
  }
}

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
