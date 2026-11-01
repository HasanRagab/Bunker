import { err, ok, type Result } from "../core/result";

type Cleanup = () => void | Promise<void>;

/**
 * Coordinate request draining, task stops, server closure, and cleanup.
 * @example
 * ```ts
 * const shutdown = createShutdown({ timeoutMs: 20_000 });
 * shutdown.register(() => database.close());
 * ```
 */
export function createShutdown(options: {
  timeoutMs?: number;
  onError?: (error: Error) => void;
  onSignal?: (signal: string) => void;
} = {}) {
  const cleanups: Cleanup[] = [];
  const stopTasks: Cleanup[] = [];
  const serverStops: Cleanup[] = [];
  const activeWaiters: Array<() => void> = [];
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new RangeError("Shutdown timeout must be positive");
  let active = 0;
  let draining = false;
  let shutdownResult: Promise<Result<void, Error>> | undefined;

  const register = (cleanup: Cleanup) => {
    if (draining) throw new Error("Cannot register cleanup after shutdown has started");
    cleanups.push(cleanup);
  };

  const registerStop = (stop: Cleanup) => {
    if (draining) throw new Error("Cannot register stop task after shutdown has started");
    stopTasks.push(stop);
  };

  const wrap = (handler: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
    if (draining) return new Response("Service Unavailable", { status: 503, headers: { connection: "close" } });
    active++;
    try {
      return await handler(req);
    } finally {
      active--;
      if (active === 0) activeWaiters.splice(0).forEach((resolve) => resolve());
    }
  };

  const shutdown = (signal = "shutdown"): Promise<Result<void, Error>> => {
    if (shutdownResult) return shutdownResult;
    draining = true;
    shutdownResult = (async () => {
      const failures: Error[] = [];
      try {
        options.onSignal?.(signal);
      } catch (cause) {
        failures.push(asError(cause));
      }
      for (const stop of stopTasks) {
        try {
          await stop();
        } catch (cause) {
          failures.push(asError(cause));
        }
      }
      try {
        if (active > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timed out draining requests after ${timeoutMs}ms`)), timeoutMs);
            activeWaiters.push(() => {
              clearTimeout(timer);
              resolve();
            });
          });
        }
      } catch (cause) {
        failures.push(asError(cause));
      }
      for (const stop of serverStops) {
        try {
          await stop();
        } catch (cause) {
          failures.push(asError(cause));
        }
      }
      for (const cleanup of [...cleanups].reverse()) {
        try {
          await cleanup();
        } catch (cause) {
          failures.push(asError(cause));
        }
      }
      if (failures.length === 0) return ok(undefined);
      const error = failures.length === 1 ? failures[0]! : new AggregateError(failures, "Shutdown completed with errors");
      options.onError?.(error);
      return err(error);
    })();
    return shutdownResult;
  };

  const installSignals = () => {
    const handle = (signal: NodeJS.Signals) => {
      void shutdown(signal).then((result) => {
        if (!result.ok) process.exitCode = 1;
      });
    };
    process.once("SIGINT", handle);
    process.once("SIGTERM", handle);
    return () => {
      process.off("SIGINT", handle);
      process.off("SIGTERM", handle);
    };
  };

  const attachServer = <Data>(server: Bun.Server<Data>) => {
    if (draining) throw new Error("Cannot attach a server after shutdown has started");
    serverStops.push(() => { server.stop(true); });
  };

  return { register, registerStop, wrap, shutdown, installSignals, attachServer, get isDraining() { return draining; } };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
