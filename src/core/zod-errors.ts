import type { ZodIssue } from "zod";

/**
 * Format Zod issues as actionable boot-time configuration diagnostics.
 * @example
 * ```ts
 * const message = formatZodIssues("Environment", "environment variable", issues);
 * ```
 */
export function formatZodIssues(
  subject: string,
  valueName: string,
  issues: readonly ZodIssue[],
): string {
  const details = issues.map((issue) => {
    const path = issue.path.length === 0 ? "<root>" : issue.path.map(String).join(".");
    return `  - ${path}: ${issue.message}`;
  });
  return `${subject} is invalid. Update each listed ${valueName} to match its declared schema:\n${details.join("\n")}`;
}
