import { err, ok, type Result } from "../core/result";
import type { z } from "zod";

/** Atomic string storage used by cache and coordination adapters.
 * @example
 * ```ts
 * const store: CacheStore = memoryCache();
 * ```
 */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  increment(key: string, ttlMs: number): Promise<number>;
  compareAndSet(key: string, expected: string, value: string, ttlMs: number): Promise<boolean>;
  compareAndDelete(key: string, expected: string): Promise<boolean>;
}

/**
 * Legacy class-based memory cache store.
 * @deprecated Use {@link memoryCache}.
 * @example
 * ```ts
 * const store = new MemoryCacheStore();
 * ```
 */
export class MemoryCacheStore implements CacheStore {
  #entries = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.#entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.#entries.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean> {
    const current = this.#entries.get(key);
    if (current && current.expiresAt > Date.now()) return false;
    this.#entries.set(key, { value, expiresAt: Date.now() + Math.max(0, ttlMs) });
    return true;
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("TTL must be positive");
    const entry = this.#entries.get(key);
    const current = Number(entry && entry.expiresAt > Date.now() ? entry.value : 0);
    if (!Number.isSafeInteger(current)) throw new TypeError("Cache counter is not a safe integer");
    const next = current + 1;
    this.#entries.set(key, { value: String(next), expiresAt: entry && entry.expiresAt > Date.now() ? entry.expiresAt : Date.now() + Math.max(0, ttlMs) });
    return next;
  }

  async compareAndSet(key: string, expected: string, value: string, ttlMs: number): Promise<boolean> {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError("TTL must be positive");
    const current = this.#entries.get(key);
    if (!current || current.expiresAt <= Date.now() || current.value !== expected) return false;
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }

  async compareAndDelete(key: string, expected: string): Promise<boolean> {
    const current = this.#entries.get(key);
    if (!current || current.expiresAt <= Date.now() || current.value !== expected) return false;
    this.#entries.delete(key);
    return true;
  }
}

/**
 * Create a process-local cache store.
 * @example
 * ```ts
 * const cache = createCache(memoryCache());
 * ```
 */
export function memoryCache(): MemoryCacheStore {
  return new MemoryCacheStore();
}

/**
 * Create a typed cache facade over a pluggable store.
 * @example
 * ```ts
 * const cache = createCache(memoryCache());
 * const value = await cache.wrap("key", 60_000, () => ({ id: "u1" }));
 * ```
 */
export function createCache(store: CacheStore) {
  return {
    async get<T>(key: string, schema: { parse(value: unknown): T }): Promise<Result<T | null, Error>> {
      try {
        const value = await store.get(key);
        return ok(value === null ? null : schema.parse(JSON.parse(value)));
      } catch (cause) {
        return err(asError(cause));
      }
    },
    async set<T>(key: string, value: T, ttlMs: number): Promise<Result<void, Error>> {
      try {
        if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new RangeError("Cache TTL must be a non-negative finite number");
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new TypeError("Cache values must be JSON serializable");
        await store.set(key, serialized, ttlMs);
        return ok(undefined);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    async delete(key: string): Promise<Result<void, Error>> {
      try {
        await store.delete(key);
        return ok(undefined);
      } catch (cause) {
        return err(asError(cause));
      }
    },
    /**
     * Load and cache a value, optionally validating it and preventing stampedes.
     * @example
     * ```ts
     * const user = await cache.wrap("user:1", 60_000, () => loadUser(), {
     *   schema: z.object({ id: z.string() }),
     *   stampede: true,
     * });
     * ```
     */
    async wrap<T>(
      key: string,
      ttlMs: number,
      fn: () => T | Promise<T>,
      options: {
        schema?: z.ZodType<T>;
        stampede?: boolean | { lockTtlMs?: number; waitMs?: number; pollMs?: number };
      } = {},
    ): Promise<Result<T, Error>> {
      if (!Number.isFinite(ttlMs) || ttlMs < 0) return err(new RangeError("Cache TTL must be a non-negative finite number"));
      const stampede = options.stampede === true ? {} : options.stampede || undefined;
      const lockTtlMs = stampede?.lockTtlMs ?? 30_000;
      const waitMs = stampede?.waitMs ?? 5_000;
      const pollMs = stampede?.pollMs ?? 25;
      if (stampede && (!Number.isFinite(lockTtlMs) || lockTtlMs <= 0 ||
        !Number.isFinite(waitMs) || waitMs < 0 ||
        !Number.isFinite(pollMs) || pollMs < 1)) {
        return err(new RangeError("Stampede lock TTL and poll interval must be positive; wait time must be non-negative"));
      }
      const readCached = async (): Promise<Result<T | null, Error>> => {
        try {
          const serialized = await store.get(key);
          if (serialized === null) return ok(null);
          const parsed: unknown = JSON.parse(serialized);
          if (!options.schema) return ok(parsed as T);
          const validated = options.schema.safeParse(parsed);
          return validated.success ? ok(validated.data) : err(validated.error);
        } catch (cause) {
          return err(asError(cause));
        }
      };
      let lockToken: string | undefined;
      if (stampede) {
        const lockKey = `${key}:__bunker_stampede`;
        const token = crypto.randomUUID();
        const deadline = Date.now() + waitMs;
        while (true) {
          const cached = await readCached();
          if (!cached.ok) return cached;
          if (cached.value !== null) return ok(cached.value);
          try {
            if (await store.setIfAbsent(lockKey, token, lockTtlMs)) {
              lockToken = token;
              break;
            }
          } catch (cause) {
            return err(asError(cause));
          }
          if (Date.now() >= deadline) {
            return err(new Error(`Timed out waiting for cache stampede lock for key: ${key}`));
          }
          await Bun.sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
        }
      } else {
        const cached = await readCached();
        if (!cached.ok) return cached;
        if (cached.value !== null) return ok(cached.value);
      }
      let result: Result<T, Error>;
      try {
        const value = await fn();
        if (options.schema) {
          const validated = options.schema.safeParse(value);
          if (!validated.success) result = err(validated.error);
          else {
            const serialized = JSON.stringify(validated.data);
            if (serialized === undefined) throw new TypeError("Cache values must be JSON serializable");
            await store.set(key, serialized, ttlMs);
            result = ok(validated.data);
          }
        } else {
          const serialized = JSON.stringify(value);
          if (serialized === undefined) throw new TypeError("Cache values must be JSON serializable");
          await store.set(key, serialized, ttlMs);
          result = ok(value);
        }
      } catch (cause) {
        result = err(asError(cause));
      }
      if (lockToken) {
        try {
          await store.compareAndDelete(`${key}:__bunker_stampede`, lockToken);
        } catch (cause) {
          return err(asError(cause));
        }
      }
      return result;
    },
  };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
