import { z } from "zod";

/**
 * Validate env once at boot. Fails fast with a readable message.
 *   const env = defineEnv({ PORT: z.coerce.number().default(3000) });
 */
export function defineEnv<S extends z.ZodRawShape>(
  shape: S,
  source: Record<string, string | undefined> = Bun.env,
): Readonly<z.infer<z.ZodObject<S>>> {
  const parsed = z.object(shape).safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join("\n")}`);
  }
  return Object.freeze(parsed.data);
}
