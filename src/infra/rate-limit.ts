/** Atomic sliding-window counter contract for rate-limit adapters.
 * @example
 * ```ts
 * const store: RateLimitStoreLike = memoryRateLimit();
 * ```
 */
export interface RateLimitStoreLike {
  increment(key: string, windowMs: number, now: number): Promise<{ count: number; resetAt: number }>;
}

/** Alias for the rate-limit store contract.
 * @example
 * ```ts
 * const store: RateLimitStore = memoryRateLimit();
 * ```
 */
export type RateLimitStore = RateLimitStoreLike;

/**
 * Legacy class-based in-memory rate-limit store.
 * @deprecated Use {@link memoryRateLimit}.
 * @example
 * ```ts
 * const store = new MemoryRateLimitStore();
 * ```
 */
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

/**
 * Create a process-local rate-limit store.
 * @example
 * ```ts
 * const store = memoryRateLimit();
 * ```
 */
export function memoryRateLimit(): MemoryRateLimitStore {
  return new MemoryRateLimitStore();
}
