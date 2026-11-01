import { createLogger, type Logger } from "../core/logger";
import type { RedisClient } from "../infra/redis-client";

export interface ServiceInstance {
  readonly name: string;
  readonly instanceId: string;
  readonly endpoint: string;
  readonly transport: "http" | "tcp";
}

export interface ServiceRegistration {
  refresh(): Promise<void>;
  close(): Promise<void>;
}

export interface ServiceRegistry {
  register(instance: ServiceInstance, options?: { ttlMs?: number; heartbeatMs?: number }): Promise<ServiceRegistration>;
  discover(name: string): Promise<ServiceInstance[]>;
}

/** @deprecated Use {@link memoryServiceRegistry}. */
export class MemoryServiceRegistry implements ServiceRegistry {
  #instances = new Map<string, Map<string, { instance: ServiceInstance; expiresAt: number }>>();

  constructor(private readonly logger: Logger = createLogger()) {}

  async register(instance: ServiceInstance, options: { ttlMs?: number; heartbeatMs?: number } = {}): Promise<ServiceRegistration> {
    const ttlMs = options.ttlMs ?? 30_000;
    const heartbeatMs = options.heartbeatMs ?? Math.floor(ttlMs / 3);
    validateRegistration(instance, ttlMs, heartbeatMs);
    let active = true;
    const save = async () => {
      if (!active) throw new Error("Service registration is closed");
      const entries = this.#instances.get(instance.name) ?? new Map();
      entries.set(instance.instanceId, { instance, expiresAt: Date.now() + ttlMs });
      this.#instances.set(instance.name, entries);
    };
    await save();
    const timer = setInterval(() => {
      void save().catch((cause) => this.logger.error("Service registry heartbeat failed", { error: asError(cause), service: instance.name, instanceId: instance.instanceId }));
    }, heartbeatMs);
    timer.unref();
    return {
      refresh: save,
      close: async () => {
        if (!active) return;
        active = false;
        clearInterval(timer);
        const entries = this.#instances.get(instance.name);
        entries?.delete(instance.instanceId);
        if (entries?.size === 0) this.#instances.delete(instance.name);
      },
    };
  }

  async discover(name: string): Promise<ServiceInstance[]> {
    const entries = this.#instances.get(name);
    if (!entries) return [];
    const now = Date.now();
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(id);
    }
    if (entries.size === 0) {
      this.#instances.delete(name);
      return [];
    }
    return [...entries.values()].map(({ instance }) => instance);
  }
}

/** @deprecated Use {@link redisServiceRegistry}. */
export class RedisServiceRegistry implements ServiceRegistry {
  constructor(
    private readonly redis: RedisClient,
    private readonly prefix = "bunker:services:",
    private readonly logger: Logger = createLogger(),
  ) {}

  async register(instance: ServiceInstance, options: { ttlMs?: number; heartbeatMs?: number } = {}): Promise<ServiceRegistration> {
    const ttlMs = options.ttlMs ?? 30_000;
    const heartbeatMs = options.heartbeatMs ?? Math.floor(ttlMs / 3);
    validateRegistration(instance, ttlMs, heartbeatMs);
    const key = this.key(instance.name);
    const member = JSON.stringify(instance);
    let active = true;
    const refresh = async () => {
      if (!active) throw new Error("Service registration is closed");
      const expiresAt = Date.now() + ttlMs;
      const result = await this.redis.eval(REGISTRY_UPSERT, {
        keys: [key],
        arguments: [String(expiresAt), member],
      });
      if (Number(result) !== 1) throw new Error("Redis service registry heartbeat failed");
    };
    await refresh();
    const timer = setInterval(() => {
      void refresh().catch((cause) => this.logger.error("Redis service registry heartbeat failed", { error: asError(cause), service: instance.name, instanceId: instance.instanceId }));
    }, heartbeatMs);
    timer.unref();
    return {
      refresh,
      close: async () => {
        if (!active) return;
        active = false;
        clearInterval(timer);
        await this.redis.eval(REGISTRY_REMOVE, {
          keys: [key],
          arguments: [member],
        });
      },
    };
  }

  async discover(name: string): Promise<ServiceInstance[]> {
    assertServiceName(name);
    const key = this.key(name);
    const result = await this.redis.eval(REGISTRY_DISCOVER, {
      keys: [key],
      arguments: [String(Date.now())],
    });
    if (!Array.isArray(result)) throw new Error("Invalid Redis service registry response");
    return result.map(parseServiceInstance);
  }

  private key(name: string): string {
    assertServiceName(name);
    return `${this.prefix}{${name}}`;
  }
}

function parseServiceInstance(value: unknown): ServiceInstance {
  if (typeof value === "string") {
    try {
      return parseServiceInstance(JSON.parse(value));
    } catch (cause) {
      throw new Error("Invalid service instance record", { cause });
    }
  }
  if (typeof value !== "object" || value === null ||
      !("name" in value) || typeof value.name !== "string" ||
      !("instanceId" in value) || typeof value.instanceId !== "string" ||
      !("endpoint" in value) || typeof value.endpoint !== "string" ||
      !("transport" in value) || (value.transport !== "http" && value.transport !== "tcp")) {
    throw new Error("Invalid service instance record");
  }
  return value as ServiceInstance;
}

function validateRegistration(instance: ServiceInstance, ttlMs: number, heartbeatMs: number): void {
  assertServiceName(instance.name);
  if (!instance.instanceId) throw new TypeError("Service instance ID must not be empty");
  if (instance.transport === "http") {
    const endpoint = new URL(instance.endpoint);
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") throw new TypeError("Invalid HTTP service endpoint");
  } else {
    const endpoint = new URL(instance.endpoint);
    if (endpoint.protocol !== "tcp:" || !endpoint.hostname || !endpoint.port) throw new TypeError("Invalid TCP service endpoint");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 3) throw new RangeError("Service registry TTL must be at least 3ms");
  if (!Number.isFinite(heartbeatMs) || heartbeatMs < 1 || heartbeatMs >= ttlMs) {
    throw new RangeError("Heartbeat interval must be positive and shorter than the registration TTL");
  }
}

export function assertServiceName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name)) throw new TypeError(`Invalid service name: ${name}`);
}

/** Create a process-local service registry. */
export function memoryServiceRegistry(logger?: Logger): MemoryServiceRegistry {
  return new MemoryServiceRegistry(logger);
}

/** Create a Redis-backed service registry. */
export function redisServiceRegistry(
  redis: RedisClient,
  prefix = "bunker:services:",
  logger?: Logger,
): RedisServiceRegistry {
  return new RedisServiceRegistry(redis, prefix, logger);
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

const REGISTRY_UPSERT = `
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])
return 1
`;

const REGISTRY_DISCOVER = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
return redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], '+inf')
`;

const REGISTRY_REMOVE = `
return redis.call('ZREM', KEYS[1], ARGV[1])
`;
