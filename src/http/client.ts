import { z } from "zod";
import { err, ok, type Result } from "../result";
import type { BaseCtx, PathParams, RouteContract, RouteMap, Router } from "./router";

type PathsFor<R, M extends string> = { [K in keyof R]: K extends `${M} ${infer P}` ? P : never }[keyof R];
type ContractFor<R, M extends string, P extends string> = R[Extract<keyof R, `${M} ${P}`>] & RouteContract;
type Input<S> = S extends z.ZodType ? z.input<S> : never;
type Output<S> = S extends z.ZodType ? z.output<S> : unknown;

type ClientInput<C extends RouteContract> =
  (PathParams<C["path"]> extends Record<string, never> ? {} : { params: PathParams<C["path"]> }) &
  (C["query"] extends z.ZodType ? { query?: Input<C["query"]> } : {}) &
  (C["body"] extends z.ZodType ? { body: Input<C["body"]> } : {});
type InputArgs<I> = keyof I extends never ? [] : [input: I];
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ApiClientError {
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}

/**
 * Create a typed client from a router contract. Assign each route registration
 * (`router = router.get(...)`) so TypeScript can accumulate its route types.
 */
export function createClient<Ctx extends BaseCtx, Routes extends RouteMap, Prefix extends string>(
  baseUrl: string,
  router: Router<Ctx, Routes, Prefix>,
  options: { fetcher?: Fetcher; headers?: RequestInit["headers"] } = {},
) {
  const fetcher = options.fetcher ?? fetch;
  return {
    async request<M extends RouteContract["method"], P extends PathsFor<Routes, M> & string>(
      method: M,
      path: P,
      ...args: InputArgs<ClientInput<ContractFor<Routes, M, P>>>
    ): Promise<Result<Output<ContractFor<Routes, M, P>["response"]>, ApiClientError>> {
      try {
        const [input] = args;
        const params = (input as { params?: Record<string, string> } | undefined)?.params ?? {};
        const pathWithParams = path.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => {
          const value = params[key];
          if (value === undefined) throw new Error(`Missing path parameter: ${key}`);
          return encodeURIComponent(value);
        });
        const url = new URL(pathWithParams, baseUrl);
        const query = (input as { query?: Record<string, unknown> } | undefined)?.query;
        if (query) {
          for (const [key, value] of Object.entries(query)) {
            if (value !== undefined && value !== null) {
              for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
            }
          }
        }
        const body = (input as { body?: unknown } | undefined)?.body;
        const response = await fetcher(url, {
          method,
          headers: { ...Object.fromEntries(new Headers(options.headers)), ...(body === undefined ? {} : { "content-type": "application/json" }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
          const details = await response.text();
          return err({ message: details || response.statusText, status: response.status });
        }
        if (response.status === 204) return ok(undefined as Output<ContractFor<Routes, M, P>["response"]>);
        const payload: unknown = await response.json();
        return ok(router.validateResponse(method, path, payload) as Output<ContractFor<Routes, M, P>["response"]>);
      } catch (cause) {
        return err({ message: cause instanceof Error ? cause.message : "Request failed", cause });
      }
    },
  };
}
