import { z } from "zod";
import {
  bearerAuth,
  createApp,
  createCache,
  createLogger,
  createQueue,
  createScheduler,
  defineEnv,
  defineJob,
  defineModule,
  err,
  parseRole,
  rateLimit,
  redisDrivers,
  verifyJwt,
  withIdempotency,
  ok,
  type RedisClient,
  type Result,
  type ServiceRole,
} from "../src";

const ReportRequested = z.object({ reportId: z.string().min(1) });
const ReportCompleted = z.object({ reportId: z.string(), completedAt: z.string() });
const User = z.object({ id: z.string(), role: z.string() });
const eventSchemas = { "report.completed": ReportCompleted };
const env = defineEnv({
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
  ROLE: z.enum(["web", "worker", "all"]).default("all"),
});

/**
 * Start the Redis-backed report service in web, worker, or combined role.
 * @example
 * ```ts
 * const service = await startScalingExample(redisClient, subscriberClient, {
 *   closeRedis: async () => redisClient.quit(),
 * });
 * ```
 */
export async function startScalingExample(
  redis: RedisClient,
  subscriber: RedisClient,
  options: { port?: number; closeRedis: () => Promise<void> },
) {
  const { port = env.PORT, closeRedis } = options;
  const roleResult = parseRole(env.ROLE);
  if (!roleResult.ok) throw roleResult.error;
  const role: ServiceRole = roleResult.value;
  const instanceId = crypto.randomUUID();
  const logger = createLogger({ instanceId });
  const drivers = redisDrivers({ client: redis, publisher: redis, subscriber, close: closeRedis });
  const queue = createQueue(drivers.queue, { logger, visibilityTimeoutMs: 30_000 });
  const scheduler = createScheduler(queue, drivers.lock, { lockTtlMs: 120_000 });
  const events = drivers.pubsub(eventSchemas, logger);
  const cache = createCache(drivers.cache);
  const generateReport = defineJob("generate-report", ReportRequested, async ({ reportId }, context) => {
    logger.info("Generating report", { reportId, requestId: context.requestId, attempt: context.attempt });
    await events.publish("report.completed", { reportId, completedAt: new Date().toISOString() });
  }, { maxAttempts: 5, retryDelayMs: 2_000 });
  const scheduled = scheduler.add("*/5 * * * *", generateReport, { reportId: "scheduled-summary" });
  if (!scheduled.ok) throw scheduled.error;

  let unsubscribe: (() => Promise<void>) | undefined;
  const reports = defineModule({
    name: "reports",
    jobs: [generateReport],
    events: eventSchemas,
    routes: (router) => router
      .use(bearerAuth(async (token) => {
        const verified = await verifyJwt(token, env.JWT_SECRET, User);
        return verified.ok ? verified.value : null;
      }))
      .use(rateLimit({ limit: 120, windowMs: 60_000, store: drivers.rateLimit, key: ({ user }) => user.id }))
      .post("/reports", {
        body: ReportRequested,
        handler: async ({ body, requestId }) => {
          const result = await queue.enqueue(generateReport, body, { requestId });
          if (!result.ok) throw result.error;
          return Response.json({ jobId: result.value }, { status: 202 });
        },
      }),
    onStart: async () => {
      await scheduler.start();
      if (role === "worker") return;
      try {
        unsubscribe = await events.subscribe("report.completed", (event) => {
          logger.info("Report completed on a service instance", { ...event, instanceId });
        });
      } catch (error) {
        scheduler.stop();
        throw error;
      }
    },
    onStop: async () => {
      await unsubscribe?.();
      scheduler.stop();
    },
  });
  const modules = [reports] as const;
  const wrapFetch = (fetch: (request: Request) => Promise<Response>) => withIdempotency(fetch, drivers.idempotency, {
    scope: async (request) => {
      const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return "anonymous";
      const verified = await verifyJwt(token, env.JWT_SECRET, User);
      return verified.ok ? `user:${verified.value.id}` : `invalid-token:${token}`;
    },
  });

  const app = createApp({
    env: { ...env, PORT: port },
    drivers,
    modules,
    role,
    instanceId,
    server: { reusePort: true },
    health: { checks: { redis: () => redis.get("bunker:health").then(() => true) } },
    shutdown: {
      timeoutMs: 25_000,
      onSignal: (signal: string) => logger.info("Draining service", { signal, instanceId }),
      onError: (error: Error) => logger.error("Shutdown failed", { error }),
    },
    wrapFetch,
  });

  try {
    await app.start();
  } catch (cause) {
    await app.stop();
    throw cause;
  }
  return {
    role,
    cache,
    events,
    shutdown: async (): Promise<Result<void, Error>> => {
      try {
        await app.stop();
        return ok(undefined);
      } catch (cause) {
        return err(cause instanceof Error ? cause : new Error(String(cause)));
      }
    },
  };
}
