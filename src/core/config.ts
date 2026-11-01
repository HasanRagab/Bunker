import { z } from "zod";
import { formatZodIssues } from "./zod-errors";

/**
 * Validate layered configuration at boot and report every schema issue at once.
 * @example
 * ```ts
 * const config = defineConfig(z.object({ port: z.coerce.number().default(3000) }));
 * ```
 */
export function defineConfig<S extends z.ZodObject>(
  schema: S,
  options: {
    defaults?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
    overrides?: Record<string, unknown>;
  } = {},
): Readonly<z.output<S>> {
  const { defaults = {}, env = Bun.env, overrides = {} } = options;
  const parsed = schema.safeParse({ ...defaults, ...env, ...overrides });
  if (!parsed.success) {
    throw new Error(formatZodIssues("Configuration", "configuration value", parsed.error.issues));
  }
  return Object.freeze(parsed.data);
}
