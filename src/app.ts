import { createLogger, type Logger } from "./core/logger";
import { createServiceRegistry } from "./core/services";
import { createQueue, type JobContext } from "./infra/jobs";
import { createScheduler } from "./infra/scheduler";
import { memoryDrivers, type DriverBundle } from "./infra/drivers";
import type { EventSchemas, EventPayloads, PubSub } from "./infra/pubsub";
import { startRole, parseRole, type ServiceRole } from "./auth/role";
import { createRequestMetrics, metricsRoute } from "./ops/metrics";
import { createShutdown } from "./ops/shutdown";
import { healthRoutes, type HealthCheck } from "./ops/health";
import { withCors } from "./http/middleware";
import { Router, type BaseCtx, type RouteMap } from "./http/router";
import { createTestApp as createRouterTestApp, createTestRequester, type TestRequestHelpers } from "./http/testing";
import { serve } from "./http/server";
import { startModules } from "./http/module";
import type { ModuleLifecycle, ModuleRouteMetadata, ModuleRouteResult } from "./http/module";
import type { z } from "zod";

type ShutdownOptions = Parameters<typeof createShutdown>[0];
type CorsOptions = Parameters<typeof withCors>[1];
type FetchHandler = (request: Request) => Promise<Response>;
type FetchWrapper = (handler: FetchHandler) => FetchHandler;
type ServiceRegistry = ReturnType<typeof createServiceRegistry>;
type AppJob = {
  readonly name: string;
  readonly run: (payload: unknown, context: JobContext) => Promise<void>;
};
type AppModule = ModuleLifecycle & ModuleRouteMetadata & {
  readonly jobs?: readonly AppJob[];
  readonly events?: EventSchemas;
  mount(
    router: Router<BaseCtx, {}, "">,
    registry: ServiceRegistry,
  ): Pick<Router<BaseCtx>, "fetch" | "openAPI" | "validateResponse">;
};
type ModuleList = readonly AppModule[];
type RouteMapOf<Result> = Result extends Router<
  infer _Context,
  infer Routes,
  infer _Prefix
> ? Routes extends RouteMap ? Routes : {} : {};
type RoutesOf<Module> = Module extends unknown ? RouteMapOf<ModuleRouteResult<Module>> : never;
type UnionToIntersection<Values> =
  (Values extends unknown ? (value: Values) => void : never) extends (value: infer Intersection) => void
    ? Intersection
    : never;
type AppRoutes<Modules extends ModuleList> =
  [Modules[number]] extends [never] ? {} : UnionToIntersection<RoutesOf<Modules[number]>> & object;
type AppRouter<Modules extends ModuleList> = Router<BaseCtx, AppRoutes<Modules>, "">;
type AppInstance<Modules extends ModuleList, Env extends object> = {
  readonly env: Env;
  readonly drivers: DriverBundle;
  readonly logger: Logger;
  readonly services: ReturnType<typeof createServiceRegistry>;
  readonly router: AppRouter<Modules>;
  readonly pubsub: PubSub<EventPayloads<AppEventSchemas<Modules>>>;
  readonly metrics: ReturnType<typeof createRequestMetrics> | undefined;
  readonly fetch: (request: Request) => Promise<Response>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Compose the toolkit's HTTP, infrastructure, and operations helpers into an application. Pass
 * the validated result of `defineEnv` as `env`; use `wrapFetch` for cross-cutting fetch adapters.
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createApp, defineEnv, defineModule, memoryDrivers } from "@2hasan2/bunker";
 *
 * const env = defineEnv({ PORT: z.coerce.number().default(3000) });
 * const users = defineModule({
 *   name: "users",
 *   routes: (router) => router.get("/users", { handler: () => [] }),
 * });
 * const app = createApp({
 *   env,
 *   drivers: memoryDrivers(),
 *   modules: [users],
 *   role: false,
 * });
 * await app.start();
 * const response = await app.fetch(new Request("http://localhost/users"));
 * await app.stop();
 * ```
 */
export function createApp<const Options extends AppOptionsInput>(
  options: Options & (Options["modules"] extends ModuleList ? unknown : never),
): AppInstance<AppModules<Options>, Options["env"]> {
  const modules = options.modules as ModuleList;
  const instanceId = options.instanceId ?? crypto.randomUUID();
  const logger = options.logger ?? createLogger({ instanceId });
  const services = createServiceRegistry();
  const router = Router.create({ log: logger }) as AppRouter<AppModules<Options>>;
  const shutdown = options.shutdown === false ? undefined : createShutdown(options.shutdown);
  const metrics = options.metrics === false ? undefined : createRequestMetrics(instanceId);
  const schemas = collectEventSchemas(modules);
  const pubsub = options.drivers.pubsub(schemas, logger) as PubSub<EventPayloads<AppEventSchemas<AppModules<Options>>>>;
  const role = resolveRole(options.role, options.env);
  const port = resolvePort(options.server?.port, options.env);
  const queue = createQueue(options.drivers.queue, { logger });
  const scheduler = createScheduler(queue, options.drivers.lock, {
    onError: (error) => logger.error("Application scheduler failed", { error }),
  });
  const jobs = modules.flatMap((module) => module.jobs ?? []);

  if (options.health !== false) {
    healthRoutes(router, {
      ...options.health,
      isDraining: () => shutdown?.isDraining ?? false,
    });
  }
  if (metrics) {
    const metricsPath = options.metrics === false ? undefined : options.metrics?.path;
    metricsRoute(router, metrics, metricsPath);
  }

  let state: "created" | "starting" | "started" | "stopped" = "created";
  let moduleLifecycle: Awaited<ReturnType<typeof startModules>> | undefined;
  let roleCleanup: (() => Promise<void>) | undefined;
  let server: Bun.Server<unknown> | undefined;
  let unregisterSignals: (() => void) | undefined;

  let fetch = options.wrapFetch?.(router.fetch) ?? router.fetch;
  if (metrics) fetch = metrics.wrap(fetch);
  if (options.cors !== undefined && options.cors !== false) fetch = withCors(fetch, options.cors);
  if (shutdown) fetch = shutdown.wrap(fetch);

  shutdown?.registerStop(async () => roleCleanup?.());
  shutdown?.registerStop(async () => moduleLifecycle?.stop());
  shutdown?.register(() => options.drivers.close());

  const start = async (): Promise<void> => {
    if (state !== "created") {
      throw new Error(`Cannot start the application from state "${state}"; start it once, or create a new app instance to restart.`);
    }
    state = "starting";
    try {
      moduleLifecycle = await startModules(modules, services);
      for (const module of modules) {
        module.mount(router as Router<BaseCtx, {}, "">, services);
      }

      if (options.role !== false) {
        roleCleanup = await startRole(role, {
          web: async () => {
            server = serve(fetch, {
              port,
              ...(options.server?.reusePort === undefined ? {} : { reusePort: options.server.reusePort }),
            });
            if (shutdown) shutdown.attachServer(server);
          },
          worker: async () => {
            const worker = queue.start(jobs);
            await scheduler.start();
            return async () => {
              scheduler.stop();
              await worker.stop();
            };
          },
        });
      }

      if (shutdown) unregisterSignals = shutdown.installSignals();
      state = "started";
      logger.info("Application started", { role, instanceId, port: options.role === false ? undefined : port });
    } catch (error) {
      state = "started";
      try {
        await stop();
      } catch (stopError) {
        throw new AggregateError([error, stopError], "Application startup failed and cleanup was incomplete.");
      }
      throw error;
    }
  };

  const stop = async (): Promise<void> => {
    if (state === "stopped") return;
    state = "stopped";
    if (shutdown) {
      unregisterSignals?.();
      const result = await shutdown.shutdown();
      if (!result.ok) throw result.error;
      return;
    }

    const errors: unknown[] = [];
    for (const cleanup of [
      async () => roleCleanup?.(),
      async () => moduleLifecycle?.stop(),
      async () => { server?.stop(true); },
      async () => options.drivers.close(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, "Application shutdown failed.");
  };

  return {
    env: options.env,
    drivers: options.drivers,
    logger,
    services,
    router,
    pubsub,
    metrics,
    fetch,
    start,
    stop,
  };
}

/**
 * Create synthetic request helpers from a router or a started memory-backed app.
 * @example
 * ```ts
 * const testApp = await createTestApp({ modules: [usersModule] });
 * const response = await testApp.req.get("/users");
 * await testApp.stop();
 * ```
 */
export function createTestApp<
  Ctx extends BaseCtx,
  Routes extends RouteMap,
  Prefix extends string,
>(router: Router<Ctx, Routes, Prefix>, baseUrl?: string): TestRequestHelpers;
export function createTestApp<const Options extends TestAppOptionsInput>(
  options: Options & (Options["modules"] extends ModuleList ? unknown : never),
): Promise<TestAppInstance<Options>>;
export function createTestApp(
  input: Router<BaseCtx, RouteMap, string> | TestAppOptionsInput,
  baseUrl?: string,
): TestRequestHelpers | Promise<TestRequestHelpers> {
  if (input instanceof Router) return createRouterTestApp(input, baseUrl);
  return createModuleTestApp(input);
}

async function createModuleTestApp(options: TestAppOptionsInput): Promise<TestRequestHelpers> {
  const app = createApp({
    env: options.env ?? {},
    drivers: memoryDrivers(options.logger === undefined ? {} : { logger: options.logger }),
    modules: options.modules as ModuleList,
    role: false,
    health: options.health ?? false,
    metrics: options.metrics ?? false,
    shutdown: false,
    ...(options.cors === undefined ? {} : { cors: options.cors }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    ...(options.instanceId === undefined ? {} : { instanceId: options.instanceId }),
  });
  await app.start();
  const { start: _start, ...runningApp } = app;
  return { ...runningApp, ...createTestRequester(app.fetch) };
}

type AppEventSchemas<Modules extends ModuleList> = [Modules[number]] extends [never]
  ? Record<never, never>
  : UnionToIntersection<EventSchemasOf<Modules[number]>> & EventSchemas;

type AppOptions = {
  readonly env: object;
  readonly drivers: DriverBundle;
  readonly role?: ServiceRole | false;
  readonly health?: false | { checks?: Record<string, HealthCheck>; healthPath?: string; readyPath?: string };
  readonly metrics?: false | { path?: string };
  readonly shutdown?: false | ShutdownOptions;
  readonly cors?: false | CorsOptions;
  readonly logger?: Logger;
  readonly instanceId?: string;
  readonly wrapFetch?: FetchWrapper;
  readonly server?: { port?: number; reusePort?: boolean };
};
type AppOptionsInput = AppOptions & { readonly modules: readonly unknown[] };
type AppModules<Options> = Options extends { readonly modules: infer Modules extends ModuleList } ? Modules : never;
type TestAppOptionsInput = {
  readonly env?: object;
  readonly modules: readonly unknown[];
  readonly health?: AppOptions["health"];
  readonly metrics?: AppOptions["metrics"];
  readonly cors?: CorsOptions;
  readonly logger?: Logger;
  readonly instanceId?: string;
};
type TestAppModules<Options> = Options extends { readonly modules: infer Modules extends ModuleList } ? Modules : never;
type TestAppInstance<Options> = Omit<AppInstance<TestAppModules<Options>, object>, "start"> & TestRequestHelpers;

type EventSchemasOf<Module> = Module extends { readonly events?: infer Events }
  ? Events extends EventSchemas
    ? Events
    : Record<never, never>
  : Record<never, never>;

function collectEventSchemas(modules: ModuleList): EventSchemas {
  const schemas: EventSchemas = {};
  for (const module of modules) {
    for (const [event, schema] of Object.entries(module.events ?? {})) {
      if (schemas[event] && schemas[event] !== schema) {
        throw new Error(`Event "${event}" has conflicting schemas; define one shared schema for all modules.`);
      }
      schemas[event] = schema as z.ZodType;
    }
  }
  return schemas;
}

function resolveRole(role: ServiceRole | false | undefined, env: object): ServiceRole {
  if (role === false) return "all";
  if (role) return role;
  const configuredRole = "ROLE" in env && typeof env.ROLE === "string" ? env.ROLE : undefined;
  const parsed = parseRole(configuredRole);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

function resolvePort(port: number | undefined, env: object): number {
  const configuredPort = port ?? ("PORT" in env ? Number(env.PORT) : 3000);
  if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65_535) {
    throw new RangeError(`Invalid server port "${String(configuredPort)}"; set PORT or server.port to an integer from 0 to 65535.`);
  }
  return configuredPort;
}
