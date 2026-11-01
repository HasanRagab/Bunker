import { err, ok, type Result } from "../core/result";
import type { Awaitable } from "../core/types";

export type ServiceRole = "web" | "worker" | "all";
export type RoleTask = () => Awaitable<void | (() => Awaitable<void>)>;

export function parseRole(value: string | undefined = Bun.env.ROLE): Result<ServiceRole, Error> {
  const role = value ?? "all";
  return role === "web" || role === "worker" || role === "all"
    ? ok(role)
    : err(new TypeError(`Invalid ROLE "${role}"; expected web, worker, or all`));
}

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
