import type { Router } from "./router";

type TestRouter = Router<any, any, any>;

/** Call a router directly with synthetic requests; no listener or port is opened. */
export function createTestApp(router: TestRouter, baseUrl = "http://localhost") {
  const request = async (method: string, path: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(path, baseUrl);
    return router.fetch(new Request(url.toString(), { ...init, method }));
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
