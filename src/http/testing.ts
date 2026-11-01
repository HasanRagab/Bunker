import type { BaseCtx, RouteMap, Router } from "./router";

type TestFetcher = (request: Request) => Promise<Response>;

/**
 * Request helpers for exercising an app without opening a network listener.
 * @example
 * ```ts
 * const requests = createTestRequester((request) => router.fetch(request));
 * const response = await requests.req.get("/health");
 * ```
 */
export interface TestRequestHelpers {
  request(method: string, path: string, init?: RequestInit): Promise<Response>;
  readonly req: {
    get(path: string, init?: RequestInit): Promise<Response>;
    post(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    put(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    patch(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
    delete(path: string, body?: unknown, init?: RequestInit): Promise<Response>;
  };
}

/**
 * Create synthetic HTTP request helpers from a fetch handler.
 * @example
 * ```ts
 * const requests = createTestRequester((request) => router.fetch(request));
 * const response = await requests.req.get("/users");
 * ```
 */
export function createTestRequester(
  fetcher: TestFetcher,
  baseUrl = "http://localhost",
): TestRequestHelpers {
  const request = async (method: string, path: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(path, baseUrl);
    return fetcher(new Request(url.toString(), { ...init, method }));
  };

  const withJson = (method: string) => (path: string, body?: unknown, init: RequestInit = {}) =>
    request(method, path, {
      ...init,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers)) },
    });

  return {
    request,
    req: {
      get: (path: string, init?: RequestInit) => request("GET", path, init),
      post: withJson("POST"),
      put: withJson("PUT"),
      patch: withJson("PATCH"),
      delete: withJson("DELETE"),
    },
  };
}

/**
 * Call a router directly with synthetic requests; no listener or port is opened.
 * @example
 * ```ts
 * const testApp = createTestApp(router);
 * const response = await testApp.req.get("/users");
 * ```
 */
export function createTestApp<
  Ctx extends BaseCtx,
  Routes extends RouteMap,
  Prefix extends string,
>(router: Router<Ctx, Routes, Prefix>, baseUrl = "http://localhost"): TestRequestHelpers {
  return createTestRequester(router.fetch, baseUrl);
}
