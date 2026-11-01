export interface RateLimitStoreLike {
  increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

export type RateLimitStore = RateLimitStoreLike;

/** @deprecated Use {@link memoryRateLimit}. */
export class MemoryRateLimitStore implements RateLimitStore {
  #windows = new Map<string, { count: number; resetAt: number }>();
  #operations = 0;

  async increment(key: string, windowMs: number, now: number) {
    if (++this.#operations % 100 === 0) {
      for (const [storedKey, value] of this.#windows) {
        if (value.resetAt <= now) this.#windows.delete(storedKey);
      }
    }
    let window = this.#windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowMs };
      this.#windows.set(key, window);
    }
    window.count++;
    return { ...window };
  }
}

/** Create a process-local rate-limit store. */
export function memoryRateLimit(): MemoryRateLimitStore {
  return new MemoryRateLimitStore();
}
