import type { CacheStore } from "./cache";
import type { RateLimitStore } from "./rate-limit";
import type { Lock } from "./lock";
import type { QueueStore, QueuedJob } from "./jobs";
import type { PubSub, EventSchemas } from "./pubsub";

export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
}

export class RedisCacheStore implements CacheStore {
  constructor(private readonly redis: RedisClient, private readonly prefix = "kit:cache:") {}

  get(key: string): Promise<string | null> {
    return this.redis.get(this.key(key));
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError("TTL must be a non-negative finite number");
    await this.redis.set(this.key(key), value, { PX: Math.max(1, Math.ceil(ttlMs)) });
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(this.key(key));
  }

  async del(key: string): Promise<void> {
    await this.delete(key);
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    validateTtl(ttlMs);
    return (await this.redis.set(this.key(key), value, { PX: Math.max(1, Math.ceil(ttlMs)), NX: true })) === "OK";
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    validateTtl(ttlMs);
    const result = await this.redis.eval(INCREMENT_WITH_TTL, {
      keys: [this.key(key)],
      arguments: [String(Math.max(1, Math.ceil(ttlMs)))],
    });
    return integerResult(result, "Redis increment");
  }

  async compareAndSet(key: string, expected: string, value: string, ttlMs: number): Promise<boolean> {
    validateTtl(ttlMs);
    return integerResult(await this.redis.eval(CACHE_COMPARE_AND_SET, {
      keys: [this.key(key)],
      arguments: [expected, value, String(Math.max(1, Math.ceil(ttlMs)))],
    }), "Redis compare-and-set") === 1;
  }

  async compareAndDelete(key: string, expected: string): Promise<boolean> {
    return integerResult(await this.redis.eval(CACHE_COMPARE_AND_DELETE, {
      keys: [this.key(key)],
      arguments: [expected],
    }), "Redis compare-and-delete") === 1;
  }

  private key(key: string): string {
    return `${this.prefix}${key}`;
  }
}

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: RedisClient, private readonly prefix = "kit:rate:") {}

  async increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }> {
    validateTtl(windowMs);
    const result = await this.redis.eval(RATE_LIMIT_INCREMENT, {
      keys: [`${this.prefix}${key}`],
      arguments: [String(Math.max(1, Math.ceil(windowMs))), String(now)],
    });
    if (!Array.isArray(result) || result.length !== 2) throw new Error("Invalid Redis rate-limit response");
    const count = integerResult(result[0], "Redis rate-limit count");
    const ttl = integerResult(result[1], "Redis rate-limit TTL");
    return { count, resetAt: now + Math.max(0, ttl) };
  }
}

export class RedisQueueStore implements QueueStore {
  constructor(private readonly redis: RedisClient, private readonly prefix = "kit:jobs:") {}

  async enqueue(job: QueuedJob): Promise<void> {
    await this.redis.eval(QUEUE_ENQUEUE, {
      keys: [this.jobsKey(), this.pendingKey()],
      arguments: [job.id, String(job.runAt), JSON.stringify(job)],
    });
  }

  async claim(now: number, visibilityTimeoutMs: number): Promise<QueuedJob | null> {
    validateTtl(visibilityTimeoutMs);
    const raw = await this.redis.eval(QUEUE_CLAIM, {
      keys: [this.jobsKey(), this.pendingKey(), this.processingKey()],
      arguments: [String(now), String(now + Math.max(1, Math.ceil(visibilityTimeoutMs)))],
    });
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "string") throw new Error("Invalid Redis queue response");
    const parsed: unknown = JSON.parse(raw);
    const job = parseJob(parsed);
    return job;
  }

  async extend(id: string, leaseUntil: number): Promise<boolean> {
    const result = await this.redis.eval(QUEUE_EXTEND, {
      keys: [this.processingKey()],
      arguments: [id, String(leaseUntil)],
    });
    return integerResult(result, "Redis queue lease") === 1;
  }

  async retry(job: QueuedJob, runAt: number): Promise<void> {
    const updated = { ...job, attempts: job.attempts + 1, runAt };
    await this.redis.eval(QUEUE_RETRY, {
      keys: [this.jobsKey(), this.pendingKey(), this.processingKey()],
      arguments: [job.id, JSON.stringify(updated), String(runAt)],
    });
  }

  async remove(id: string): Promise<void> {
    await this.redis.eval(QUEUE_REMOVE, {
      keys: [this.jobsKey(), this.pendingKey(), this.processingKey()],
      arguments: [id],
    });
  }

  private jobsKey(): string {
    return `${this.prefix}{queue}:records`;
  }

  private pendingKey(): string {
    return `${this.prefix}{queue}:pending`;
  }

  private processingKey(): string {
    return `${this.prefix}{queue}:processing`;
  }
}

export function createRedisPubSub<Events extends EventSchemas>(
  publisher: RedisClient,
  subscriber: RedisClient,
  schemas: Events,
  options: { prefix?: string } = {},
): PubSub<{ [K in keyof Events]: import("zod").output<Events[K]> }> {
  const prefix = options.prefix ?? "kit:events:";
  const listeners = new Map<string, Set<(payload: unknown) => void | Promise<void>>>();
  const subscribed = new Set<string>();

  return {
    async publish(event, payload) {
      const schema = schemas[event];
      if (!schema) throw new Error(`No schema registered for event: ${String(event)}`);
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw parsed.error;
      await publisher.publish(`${prefix}${String(event)}`, JSON.stringify(parsed.data));
    },
    async subscribe(event, listener) {
      const channel = `${prefix}${String(event)}`;
      const handlers = listeners.get(channel) ?? new Set();
      const wrapped = listener as (payload: unknown) => void | Promise<void>;
      handlers.add(wrapped);
      listeners.set(channel, handlers);
      if (!subscribed.has(channel)) {
        await subscriber.subscribe(channel, (message) => {
          let payload: unknown;
          try {
            payload = JSON.parse(message);
          } catch (cause) {
            console.error("Invalid JSON received from Redis pub/sub", cause);
            return;
          }
          const schema = schemas[event];
          if (!schema) {
            console.error(`No schema registered for event: ${String(event)}`);
            return;
          }
          const parsed = schema.safeParse(payload);
          if (!parsed.success) {
            console.error("Invalid event received from Redis pub/sub", parsed.error);
            return;
          }
          for (const handler of listeners.get(channel) ?? []) {
            void Promise.resolve(handler(parsed.data)).catch((cause) => console.error("Redis pub/sub handler failed", cause));
          }
        });
        subscribed.add(channel);
      }
      return async () => {
        handlers.delete(wrapped);
        if (handlers.size === 0 && subscribed.delete(channel)) {
          listeners.delete(channel);
          await subscriber.unsubscribe(channel);
        }
      };
    },
  };
}

function parseJob(value: unknown): QueuedJob {
  if (typeof value !== "object" || value === null) throw new Error("Invalid Redis queue job");
  const job = value as Partial<QueuedJob>;
  if (
    typeof job.id !== "string" ||
    typeof job.name !== "string" ||
    typeof job.attempts !== "number" ||
    typeof job.maxAttempts !== "number" ||
    typeof job.retryDelayMs !== "number" ||
    typeof job.runAt !== "number" ||
    !("payload" in job)
  ) throw new Error("Invalid Redis queue job");
  return job as QueuedJob;
}

function integerResult(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(number)) throw new Error(`${label} returned an invalid value`);
  return number;
}

function validateTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("TTL must be a positive finite number");
}

const INCREMENT_WITH_TTL = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return value
`;

const CACHE_COMPARE_AND_SET = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

const CACHE_COMPARE_AND_DELETE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const RATE_LIMIT_INCREMENT = `
local value = redis.call('INCR', KEYS[1])
if value == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return { value, redis.call('PTTL', KEYS[1]) }
`;

const QUEUE_ENQUEUE = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
return 1
`;

const QUEUE_CLAIM = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[1])
for _, id in ipairs(expired) do
  redis.call('ZREM', KEYS[3], id)
  if redis.call('HEXISTS', KEYS[1], id) == 1 then redis.call('ZADD', KEYS[2], ARGV[1], id) end
end
local ids = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1], 'LIMIT', 0, 1)
if #ids == 0 then return nil end
local id = ids[1]
redis.call('ZREM', KEYS[2], id)
redis.call('ZADD', KEYS[3], ARGV[2], id)
return redis.call('HGET', KEYS[1], id)
`;

const QUEUE_EXTEND = `
if redis.call('ZSCORE', KEYS[1], ARGV[1]) == false then return 0 end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[1])
return 1
`;

const QUEUE_RETRY = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
return 1
`;

const QUEUE_REMOVE = `
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;
