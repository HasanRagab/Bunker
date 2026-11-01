import { createLogger, type Logger } from "../core/logger";
import { memoryCache, type CacheStore } from "./cache";
import { memoryLock, redisLock, type Lock } from "./lock";
import { memoryPubSub, type EventPayloads, type EventSchemas, type PubSub } from "./pubsub";
import { memoryQueue, type QueueStore } from "./jobs";
import { memoryRateLimit, type RateLimitStore } from "./rate-limit";
import { redisCache, redisPubSub, redisQueue, redisRateLimit, type RedisClient } from "./redis";

/**
 * Related persistence and messaging drivers selected as one application bundle.
 * @example
 * ```ts
 * const drivers: DriverBundle = memoryDrivers();
 * ```
 */
export interface DriverBundle {
  readonly kind: "memory" | "redis";
  readonly cache: CacheStore;
  readonly lock: Lock;
  readonly queue: QueueStore;
  readonly rateLimit: RateLimitStore;
  readonly idempotency: CacheStore;
  pubsub<Events extends EventSchemas>(schemas: Events, logger?: Logger): PubSub<EventPayloads<Events>>;
  close(): Promise<void>;
}

/**
 * Create process-local infrastructure drivers.
 * @example
 * ```ts
 * const drivers = memoryDrivers();
 * const cache = createCache(drivers.cache);
 * ```
 */
export function memoryDrivers(options: { logger?: Logger } = {}): DriverBundle {
  const logger = options.logger ?? createLogger();
  if (process.env.NODE_ENV === "production") {
    logger.warn("In-memory drivers are not shared across instances; configure Redis drivers for production.");
  }
  return {
    kind: "memory",
    cache: memoryCache(),
    lock: memoryLock(),
    queue: memoryQueue(),
    rateLimit: memoryRateLimit(),
    idempotency: memoryCache(),
    pubsub: (schemas, pubSubLogger) => memoryPubSub(schemas, pubSubLogger ?? logger),
    close: async () => {},
  };
}

/**
 * Redis clients used by the shared infrastructure bundle.
 * @example
 * ```ts
 * const clients: RedisDriverClients = {
 *   client: redisCommandClient,
 *   publisher: redisPublisher,
 *   subscriber: redisSubscriber,
 * };
 * ```
 */
export interface RedisDriverClients {
  readonly client: RedisClient;
  readonly publisher?: RedisClient;
  readonly subscriber?: RedisClient;
  readonly close?: () => Promise<void>;
}

/**
 * Create Redis-backed infrastructure drivers from connected clients or a URL.
 * @example
 * ```ts
 * const drivers = await redisDrivers(process.env.REDIS_URL!);
 * ```
 */
/**
 * Create Redis drivers from already-connected clients.
 * @example
 * ```ts
 * const drivers = redisDrivers({ client, publisher, subscriber });
 * ```
 */
export function redisDrivers(clients: RedisDriverClients): DriverBundle;
/**
 * Connect a Redis driver bundle using a Redis URL.
 * @example
 * ```ts
 * const drivers = await redisDrivers("redis://localhost:6379");
 * ```
 */
export function redisDrivers(url: string): Promise<DriverBundle>;
/**
 * Select the driver bundle overload for clients or a Redis URL.
 * @example
 * ```ts
 * const drivers = await redisDrivers(redisUrl);
 * ```
 */
export function redisDrivers(clientsOrUrl: RedisDriverClients | string): DriverBundle | Promise<DriverBundle> {
  if (typeof clientsOrUrl === "string") return connectRedisDrivers(clientsOrUrl);
  return createRedisDrivers(clientsOrUrl);
}

function createRedisDrivers(clients: RedisDriverClients): DriverBundle {
  const client = clients.client;
  const publisher = clients.publisher ?? client;
  const subscriber = clients.subscriber ?? client;
  return {
    kind: "redis",
    cache: redisCache(client),
    lock: redisLock(client),
    queue: redisQueue(client),
    rateLimit: redisRateLimit(client),
    idempotency: redisCache(client, ""),
    pubsub: (schemas, logger) => redisPubSub(
      publisher,
      subscriber,
      schemas,
      logger === undefined ? {} : { logger },
    ),
    close: clients.close ?? (async () => {}),
  };
}

async function connectRedisDrivers(url: string): Promise<DriverBundle> {
  if (!url.trim()) throw new TypeError("Redis URL must not be empty; provide a redis:// or rediss:// URL.");
  if (!URL.canParse(url)) {
    throw new TypeError("Invalid Redis URL; provide a complete redis:// or rediss:// URL with a host.");
  }
  const parsedUrl = new URL(url);
  if ((parsedUrl.protocol !== "redis:" && parsedUrl.protocol !== "rediss:") || !parsedUrl.hostname) {
    throw new TypeError("Invalid Redis URL; provide a redis:// or rediss:// URL with a host.");
  }
  const { createClient } = await import("redis");
  const client = createClient({ url });
  const subscriber = createClient({ url });
  try {
    await Promise.all([client.connect(), subscriber.connect()]);
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    for (const connection of [subscriber, client]) {
      try {
        if (connection.isOpen) await connection.quit();
      } catch (cause) {
        cleanupErrors.push(cause);
      }
    }
    if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], "Redis connection failed and cleanup was incomplete.");
    throw error;
  }

  const commandClient = adaptRedisClient(client);
  const subscriberClient = adaptRedisClient(subscriber);
  return createRedisDrivers({
    client: commandClient,
    publisher: commandClient,
    subscriber: subscriberClient,
    close: async () => {
      await Promise.all([subscriber.quit(), client.quit()]);
    },
  });
}

interface RedisCompatibleClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
}

function adaptRedisClient<Client extends RedisCompatibleClient>(client: Client): RedisClient {
  return {
    get: (key) => client.get(key),
    set: (key, value, options) => client.set(key, value, options),
    del: (key) => client.del(key),
    eval: (script, options) => client.eval(script, options),
    publish: (channel, message) => client.publish(channel, message),
    subscribe: async (channel, listener) => client.subscribe(channel, listener),
    unsubscribe: async (channel) => client.unsubscribe(channel),
  };
}
