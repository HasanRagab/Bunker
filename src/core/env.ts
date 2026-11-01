import { z } from "zod";
import { formatZodIssues } from "./zod-errors";

/**
 * Validate environment values at boot and report every schema issue at once.
 * @example
 * ```ts
 * const env = defineEnv({ PORT: z.coerce.number().default(3000) });
 * ```
 */
export function defineEnv<S extends z.ZodRawShape>(
  shape: S,
  source: Record<string, string | undefined> = Bun.env,
): Readonly<z.infer<z.ZodObject<S>>> {
  const parsed = z.object(shape).safeParse(source);
  if (!parsed.success) {
    throw new Error(formatZodIssues("Environment", "environment variable", parsed.error.issues));
  }
  return Object.freeze(parsed.data);
}
