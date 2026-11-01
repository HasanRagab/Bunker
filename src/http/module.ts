import type { Awaitable } from "../core/types";
import {
  createServiceRegistry,
  type ServiceToken,
} from "../core/services";
import type { JobContext } from "../infra/jobs";
import type { EventSchemas } from "../infra/pubsub";
import type { Router, BaseCtx } from "./router";

type ServiceDependencies = Readonly<Record<string, ServiceToken<unknown>>>;
type ResolvedDependencies<Dependencies extends ServiceDependencies> = {
  readonly [Key in keyof Dependencies]: Dependencies[Key] extends ServiceToken<infer Value> ? Value : never;
};
type ServiceRegistry = ReturnType<typeof createServiceRegistry>;
type RouterView = Pick<Router<BaseCtx>, "fetch" | "openAPI" | "validateResponse">;
declare const moduleRouteResult: unique symbol;
type RunnableJob = {
  readonly name: string;
  readonly run: (payload: unknown, context: JobContext) => Promise<void>;
};
type RouteBuilder<
  Dependencies extends ServiceDependencies,
  Prefix extends string,
> = (router: Router<BaseCtx, {}, Prefix>, dependencies: ResolvedDependencies<Dependencies>) => RouterView;

/**
 * Type-only metadata used to preserve module route contracts during composition.
 * @example
 * ```ts
 * const module = defineModule({ name: "users", routes: (router) => router });
 * const routeMetadata: ModuleRouteMetadata = module;
 * ```
 */
export interface ModuleRouteMetadata {
  readonly [moduleRouteResult]?: object;
}

/**
 * Lifecycle contract shared by typed modules.
 * @example
 * ```ts
 * const module = defineModule({ name: "users", routes: (router) => router });
 * const moduleLifecycle: ModuleLifecycle = module;
 * ```
 */
export interface ModuleLifecycle {
  readonly name: string;
  readonly provides: readonly ServiceToken<unknown>[];
  readonly dependencyTokens: readonly ServiceToken<unknown>[];
  start(registry: ServiceRegistry): Promise<void>;
  stop(registry: ServiceRegistry): Promise<void>;
}

/**
 * A module definition that can be composed into an application.
 * @example
 * ```ts
 * const module = defineModule({ name: "users", routes: (router) => router.get("/users", { handler: () => [] }) });
 * ```
 */
export interface ModuleDefinition<
  Name extends string = string,
  Dependencies extends ServiceDependencies = ServiceDependencies,
  Prefix extends string = string,
  Routes extends RouteBuilder<Dependencies, Prefix> = RouteBuilder<Dependencies, Prefix>,
  Jobs extends readonly RunnableJob[] = readonly RunnableJob[],
  Events extends EventSchemas = EventSchemas,
> extends ModuleLifecycle {
  readonly [moduleRouteResult]?: ReturnType<Routes>;
  readonly prefix?: Prefix;
  readonly deps: Dependencies;
  readonly routes: Routes;
  readonly jobs?: Jobs;
  readonly events?: Events;
  mount(router: Router<BaseCtx, {}, "">, registry: ServiceRegistry): ReturnType<Routes>;
  start(registry: ServiceRegistry): Promise<void>;
  stop(registry: ServiceRegistry): Promise<void>;
}

/**
 * Extract a module's router type, including every accumulated route contract.
 * @example
 * ```ts
 * const module = defineModule({ name: "users", routes: (router) => router });
 * type UserRouter = ModuleRouteResult<typeof module>;
 * ```
 */
export type ModuleRouteResult<Module> =
  Module extends { readonly [moduleRouteResult]?: infer Result } ? Exclude<Result, undefined> : never;

/**
 * Define a typed application module with route, job, event, and lifecycle metadata.
 * @example
 * ```ts
 * const module = defineModule({
 *   name: "users",
 *   deps: { repository: userRepository },
 *   routes: (router, { repository }) =>
 *     router.get("/users/:id", {
 *       handler: ({ params }) => repository.find(params.id),
 *     }),
 * });
 * ```
 */
export function defineModule<
  const Name extends string,
  Dependencies extends ServiceDependencies = {},
  const Prefix extends string = "",
  Routes extends RouteBuilder<Dependencies, Prefix> = RouteBuilder<Dependencies, Prefix>,
  Jobs extends readonly RunnableJob[] = readonly [],
  Events extends EventSchemas = Record<never, never>,
>(
  definition: {
    name: Name;
    prefix?: Prefix;
    deps?: Dependencies;
    provides?: readonly ServiceToken<unknown>[];
    routes: Routes;
    jobs?: Jobs;
    events?: Events;
    onStart?: (dependencies: ResolvedDependencies<Dependencies>, registry: ServiceRegistry) => Awaitable<void>;
    onStop?: (dependencies: ResolvedDependencies<Dependencies>, registry: ServiceRegistry) => Awaitable<void>;
  },
): ModuleDefinition<Name, Dependencies, Prefix, Routes, Jobs, Events> {
  if (!definition.name.trim()) throw new TypeError("Module name must not be empty; provide a descriptive module name.");
  const deps = definition.deps ?? ({} as Dependencies);
  const dependencyTokens = Object.values(deps);
  const resolveDependencies = (registry: ServiceRegistry): ResolvedDependencies<Dependencies> => {
    const resolved: Record<string, unknown> = {};
    for (const [key, token] of Object.entries(deps)) resolved[key] = registry.resolve(token);
    return resolved as ResolvedDependencies<Dependencies>;
  };

  return {
    name: definition.name,
    ...(definition.prefix === undefined ? {} : { prefix: definition.prefix }),
    deps,
    provides: definition.provides ?? [],
    dependencyTokens,
    routes: definition.routes,
    ...(definition.jobs === undefined ? {} : { jobs: definition.jobs }),
    ...(definition.events === undefined ? {} : { events: definition.events }),
    mount: (router, registry) => {
      const scoped = definition.prefix === undefined ? router : router.group(definition.prefix);
      return definition.routes(scoped as Router<BaseCtx, {}, Prefix>, resolveDependencies(registry)) as ReturnType<Routes>;
    },
    start: async (registry) => {
      await definition.onStart?.(resolveDependencies(registry), registry);
    },
    stop: async (registry) => {
      await definition.onStop?.(resolveDependencies(registry), registry);
    },
  };
}

/**
 * Start modules after their service providers and stop them in reverse order.
 * @example
 * ```ts
 * const lifecycle = await startModules([repositoryModule, usersModule], services);
 * await lifecycle.stop();
 * ```
 */
export async function startModules(
  modules: readonly ModuleLifecycle[],
  registry: ServiceRegistry = createServiceRegistry(),
): Promise<{ readonly order: readonly string[]; stop(): Promise<void> }> {
  const ordered = orderModules(modules);
  const started: ModuleLifecycle[] = [];

  try {
    for (const module of ordered) {
      await module.start(registry);
      started.push(module);
    }
  } catch (error) {
    const cleanupErrors = await stopInReverse(started, registry);
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Module startup failed and cleanup was incomplete.");
    throw error;
  }

  let stopped = false;
  return {
    order: ordered.map(({ name }) => name),
    async stop() {
      if (stopped) return;
      stopped = true;
      const errors = await stopInReverse(started, registry);
      if (errors.length) throw new AggregateError(errors, "One or more modules failed to stop.");
    },
  };
}

function orderModules(modules: readonly ModuleLifecycle[]): ModuleLifecycle[] {
  const providers = new Map<symbol, ModuleLifecycle>();
  for (const module of modules) {
    for (const token of module.provides) {
      const existing = providers.get(token.key);
      if (existing) throw new Error(`Service "${token.name}" is provided by both "${existing.name}" and "${module.name}".`);
      providers.set(token.key, module);
    }
  }

  const remaining = new Set(modules);
  const ordered: ModuleLifecycle[] = [];
  while (remaining.size) {
    const ready = [...remaining].find((module) =>
      module.dependencyTokens.every((token) => {
        const provider = providers.get(token.key);
        return !provider || !remaining.has(provider);
      }),
    );
    if (!ready) {
      const blocked = [...remaining].map(({ name }) => name).join(", ");
      throw new Error(`Module dependency cycle detected among: ${blocked}. Check module deps and provides.`);
    }
    remaining.delete(ready);
    ordered.push(ready);
  }
  return ordered;
}

async function stopInReverse(modules: readonly ModuleLifecycle[], registry: ServiceRegistry): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const module of [...modules].reverse()) {
    try {
      await module.stop(registry);
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}
