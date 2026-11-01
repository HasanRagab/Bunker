import { err, ok, type Result } from "../core/result";
import type { Awaitable } from "../core/types";

/** Process roles supported by `startRole`.
 * @example
 * ```ts
 * const role: ServiceRole = "worker";
 * ```
 */
export type ServiceRole = "web" | "worker" | "all";

/** Startup task that may return a cleanup callback.
 * @example
 * ```ts
 * const task: RoleTask = async () => async () => closeWorker();
 * ```
 */
export type RoleTask = () => Awaitable<void | (() => Awaitable<void>)>;

/**
 * Parse the deployment role from the environment or an explicit value.
 * @example
 * ```ts
 * const role = parseRole("web");
 * ```
 */
export function parseRole(value: string | undefined = Bun.env.ROLE): Result<ServiceRole, Error> {
  const role = value ?? "all";
  return role === "web" || role === "worker" || role === "all"
    ? ok(role)
    : err(new TypeError(`Invalid ROLE "${role}"; set ROLE to "web", "worker", or "all".`));
}

/**
 * Start tasks for the selected role and return reverse-order cleanup.
 * @example
 * ```ts
 * const stop = await startRole("worker", { worker: startQueue });
 * await stop();
 * ```
 */
export async function startRole(
  role: ServiceRole,
  tasks: { web?: RoleTask; worker?: RoleTask },
): Promise<() => Promise<void>> {
  const selected = role === "all" ? [tasks.web, tasks.worker] : [tasks[role]];
  const cleanups: Array<() => Awaitable<void>> = [];
  try {
    for (const task of selected) {
      if (!task) continue;
      const cleanup = await task();
      if (cleanup) cleanups.push(cleanup);
    }
  } catch (cause) {
    const failures: Error[] = [cause instanceof Error ? cause : new Error(String(cause))];
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (cleanupCause) {
        failures.push(cleanupCause instanceof Error ? cleanupCause : new Error(String(cleanupCause)));
      }
    }
    throw failures.length === 1 ? failures[0]! : new AggregateError(failures, "Role startup and cleanup failed");
  }
  return async () => {
    const failures: Error[] = [];
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch (cause) {
        failures.push(cause instanceof Error ? cause : new Error(String(cause)));
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Role shutdown failed");
  };
}
