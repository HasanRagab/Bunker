/**
 * Create a fetcher that forwards requests to an HTTP service base URL.
 * @example
 * ```ts
 * const fetcher = createHttpServiceFetcher("https://catalog.internal");
 * ```
 */
export function createHttpServiceFetcher(endpoint: string): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  const base = new URL(endpoint);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new TypeError("HTTP service endpoints must use http or https");
  return async (input, init) => {
    const source = input instanceof Request ? input : new Request(new URL(input.toString(), base).toString(), init);
    const sourceUrl = new URL(source.url);
    const target = new URL(`${sourceUrl.pathname}${sourceUrl.search}`, base);
    const body = source.method === "GET" || source.method === "HEAD"
      ? undefined
      : await source.arrayBuffer();
    return fetch(new Request(target.toString(), {
      method: source.method,
      headers: source.headers,
      signal: source.signal,
      ...(body === undefined ? {} : { body }),
    }));
  };
}
