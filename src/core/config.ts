import { z } from "zod";

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
    const details = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${details}`);
  }
  return Object.freeze(parsed.data);
}
