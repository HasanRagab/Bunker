/** A value that may be returned synchronously or through a promise.
 * @example
 * ```ts
 * const load: Awaitable<string> = Promise.resolve("ready");
 * ```
 */
export type Awaitable<T> = T | Promise<T>;

/** Simplify an intersection type for readable editor displays.
 * @example
 * ```ts
 * type User = Prettify<{ id: string } & { name: string }>;
 * ```
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
