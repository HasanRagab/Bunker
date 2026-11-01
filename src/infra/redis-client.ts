/**
 * Structural Redis command interface implemented by supported clients.
 * @example
 * ```ts
 * const client: RedisClient = redisCommandClient;
 * ```
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number; NX?: boolean }): Promise<string | null>;
  del(key: string): Promise<number>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
}
