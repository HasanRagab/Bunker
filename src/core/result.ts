/** Successful branch of a `Result`.
 * @example
 * ```ts
 * const result: Ok<number> = { ok: true, value: 42 };
 * ```
 */
export type Ok<T> = { readonly ok: true; readonly value: T };

/** Failed branch of a `Result`.
 * @example
 * ```ts
 * const result: Err<Error> = { ok: false, error: new Error("failed") };
 * ```
 */
export type Err<E> = { readonly ok: false; readonly error: E };

/** Discriminated union for operations that can fail.
 * @example
 * ```ts
 * const result: Result<number> = ok(42);
 * ```
 */
export type Result<T, E = Error> = Ok<T> | Err<E>;

/** Create a successful result.
 * @example
 * ```ts
 * const result = ok("saved");
 * ```
 */
export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

/** Create a failed result.
 * @example
 * ```ts
 * const result = err(new Error("not found"));
 * ```
 */
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/** Run an async operation and capture its failure as `Err`.
 * @example
 * ```ts
 * const result = await attempt(() => loadUser("u1"));
 * ```
 */
export async function attempt<T, E = Error>(
  fn: () => Promise<T>,
  mapError: (e: unknown) => E = (e) => e as E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(mapError(e));
  }
}

/** Unwrap a result, throwing its error when unsuccessful.
 * @example
 * ```ts
 * const user = unwrap(await findUser("u1"));
 * ```
 */
export function unwrap<T, E>(r: Result<T, E>): T {
  if (r.ok) return r.value;
  throw r.error;
}
