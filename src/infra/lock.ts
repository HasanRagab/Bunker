import type { RedisClient } from "./redis-client";

export interface LockLease {
  release(): Promise<void>;
}

export interface Lock {
  acquire(key: string, ttlMs: number): Promise<LockLease | null>;
}

/** An in-process lock implementation for local use and tests. */
export class MemoryLock implements Lock {
  #leases = new Map<string, { token: string; expiresAt: number }>();

  async acquire(key: string, ttlMs: number): Promise<LockLease | null> {
    if (!key) throw new TypeError("Lock key must not be empty");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("Lock TTL must be positive");
    const current = this.#leases.get(key);
    if (current && current.expiresAt > Date.now()) return null;
    const token = crypto.randomUUID();
    this.#leases.set(key, { token, expiresAt: Date.now() + ttlMs });
    let released = false;
    return {
      release: async () => {
        if (released) return;
        if (this.#leases.get(key)?.token === token) this.#leases.delete(key);
        released = true;
      },
    };
  }
}

/** Create a process-local lock driver. */
export function memoryLock(): MemoryLock {
  return new MemoryLock();
}

/** @deprecated Use {@link redisLock}. */
export class RedisLock implements Lock {
  constructor(private readonly redis: RedisClient, private readonly prefix = "bunker:lock:") {}

  async acquire(key: string, ttlMs: number): Promise<LockLease | null> {
    if (!key) throw new TypeError("Lock key must not be empty");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("Lock TTL must be positive");
    const redisKey = `${this.prefix}${key}`;
    const token = crypto.randomUUID();
    const acquired = await this.redis.set(redisKey, token, { NX: true, PX: Math.max(1, Math.ceil(ttlMs)) });
    if (acquired !== "OK") return null;

    let released = false;
    return {
      release: async () => {
        if (released) return;
        const result = await this.redis.eval(RELEASE_LOCK, { keys: [redisKey], arguments: [token] });
        if (typeof result !== "number" && typeof result !== "string") throw new Error("Invalid Redis lock release response");
        if (Number(result) !== 0 && Number(result) !== 1) throw new Error("Invalid Redis lock release response");
        released = true;
      },
    };
  }
}

const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Create a Redis-backed lock driver. */
export function redisLock(redis: RedisClient, prefix = "bunker:lock:"): RedisLock {
  return new RedisLock(redis, prefix);
}
