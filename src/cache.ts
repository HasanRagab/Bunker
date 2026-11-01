import { err, ok, type Result } from "./result";

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  del(key: string): Promise<void>;
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>;
  increment(key: string, ttlMs: number): Promise<number>;
  compareAndSet(key: string, expected: string, value: string, ttlMs: number): Promise<boolean>;
  compareAndDelete(key: string, expected: string): Promise<boolean>;
}

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

  async del(key: string): Promise<void> {
    await this.delete(key);
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
    async wrap<T>(key: string, ttlMs: number, fn: () => T | Promise<T>): Promise<Result<T, Error>> {
      if (!Number.isFinite(ttlMs) || ttlMs < 0) return err(new RangeError("Cache TTL must be a non-negative finite number"));
      const cached = await store.get(key).catch((cause) => cause);
      if (cached instanceof Error) return err(cached);
      if (cached !== null) {
        try {
          return ok(JSON.parse(cached) as T);
        } catch (cause) {
          return err(asError(cause));
        }
      }
      try {
        const value = await fn();
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw new TypeError("Cache values must be JSON serializable");
        await store.set(key, serialized, ttlMs);
        return ok(value);
      } catch (cause) {
        return err(asError(cause));
      }
    },
  };
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}
