import { z } from "zod";
import {
  createCache,
  createQueue,
  createRedisPubSub,
  createRequestMetrics,
  createScheduler,
  createShutdown,
  defineJob,
  healthRoutes,
  metricsRoute,
  parseRole,
  rateLimit,
  RedisCacheStore,
  RedisLock,
  RedisQueueStore,
  RedisRateLimitStore,
  Router,
  serve,
  startRole,
  bearerAuth,
  defineEnv,
  verifyJwt,
  withIdempotency,
  type RedisClient,
} from "../src";

const ReportRequested = z.object({ reportId: z.string().min(1) });
const ReportCompleted = z.object({ reportId: z.string(), completedAt: z.string() });
const User = z.object({ id: z.string(), role: z.string() });
const eventSchemas = { "report.completed": ReportCompleted };
const env = defineEnv({
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().default(3000),
});

export async function startScalingExample(
  redis: RedisClient,
  subscriber: RedisClient,
  options: { port?: number; closeRedis: () => Promise<void> },
) {
  const { port = env.PORT, closeRedis } = options;
  const roleResult = parseRole();
  if (!roleResult.ok) throw roleResult.error;
  const role = roleResult.value;

  const metrics = createRequestMetrics();
  const cacheStore = new RedisCacheStore(redis);
  const queueStore = new RedisQueueStore(redis);
  const queue = createQueue(queueStore, {
    visibilityTimeoutMs: 30_000,
    onError: (error, job) => console.error("Job failed", { error, jobId: job.id, requestId: job.requestId }),
  });
  const locks = new RedisLock(redis);
  const scheduler = createScheduler(queue, locks, { lockTtlMs: 120_000 });
  const events = createRedisPubSub(redis, subscriber, eventSchemas);

  const generateReport = defineJob(
    "generate-report",
    ReportRequested,
    async ({ reportId }, context) => {
      console.info("Generating report", {
        reportId,
        instanceId: metrics.instanceId,
        requestId: context.requestId,
        attempt: context.attempt,
      });
      await events.publish("report.completed", { reportId, completedAt: new Date().toISOString() });
    },
    { maxAttempts: 5, retryDelayMs: 2_000 },
  );
  const schedule = scheduler.add("*/5 * * * *", generateReport, { reportId: "scheduled-summary" });
  if (!schedule.ok) throw schedule.error;

  const shutdown = createShutdown({
    timeoutMs: 25_000,
    onSignal: (signal) => console.info("Draining service", { signal, instanceId: metrics.instanceId }),
    onError: (error) => console.error("Shutdown failed", error),
  });
  shutdown.register(closeRedis);

  const api = Router.create();

  healthRoutes(api, {
    checks: {
      redis: async () => {
        await redis.get("bunker:health");
        return true;
      },
    },
    isDraining: () => shutdown.isDraining,
  });

  const limitedApi = api
    .use(bearerAuth(async (token) => {
      const verified = await verifyJwt(token, env.JWT_SECRET, User);
      return verified.ok ? verified.value : null;
    }))
    .use(rateLimit({
      limit: 120,
      windowMs: 60_000,
      store: new RedisRateLimitStore(redis),
      key: ({ user }) => user.id,
    }));

  limitedApi.post("/reports", {
    body: ReportRequested,
    handler: async ({ body, requestId }) => {
      const result = await queue.enqueue(generateReport, body, { requestId });
      if (!result.ok) throw result.error;
      return Response.json({ jobId: result.value }, { status: 202 });
    },
  });

  metricsRoute(api, metrics);
  const cache = createCache(cacheStore);
  const fetch = metrics.wrap(shutdown.wrap(withIdempotency(api.fetch, cacheStore, {
    scope: async (request) => {
      const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) return "anonymous";
      const verified = await verifyJwt(token, env.JWT_SECRET, User);
      return verified.ok ? `user:${verified.value.id}` : `invalid-token:${token}`;
    },
  })));
  let schedulerStarted = false;
  const startScheduler = async () => {
    if (!schedulerStarted) {
      await scheduler.start();
      schedulerStarted = true;
    }
    return () => {
      if (!schedulerStarted) return;
      scheduler.stop();
      schedulerStarted = false;
    };
  };

  let stopRole: () => Promise<void>;
  try {
    stopRole = await startRole(role, {
      web: async () => {
        const stopScheduler = await startScheduler();
        let unsubscribe: () => Promise<void> = async () => {};
        let server: ReturnType<typeof serve> | undefined;
        try {
          unsubscribe = await events.subscribe("report.completed", (event) => {
            console.info("Report completed on a service instance", { ...event, instanceId: metrics.instanceId });
          });
          server = serve(fetch, { port, reusePort: true });
          shutdown.attachServer(server);
          return async () => {
            await unsubscribe();
            stopScheduler();
          };
        } catch (cause) {
          await unsubscribe();
          stopScheduler();
          server?.stop(true);
          throw cause;
        }
      },
      worker: async () => {
        const stopScheduler = await startScheduler();
        const worker = queue.start([generateReport]);
        return async () => {
          await worker.stop();
          stopScheduler();
        };
      },
    });
  } catch (cause) {
    await shutdown.shutdown("startup-failure");
    throw cause;
  }
  shutdown.registerStop(stopRole);
  shutdown.installSignals();

  return {
    role,
    shutdown: () => shutdown.shutdown(),
    cache,
    events,
  };
}
