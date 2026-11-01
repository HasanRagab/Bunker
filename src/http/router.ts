import { z } from "zod";
import { HttpError } from "../core/errors";
import { createLogger, type Logger } from "../core/logger";
import type { Awaitable } from "../core/types";

/* ---------- Types ---------- */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type RouteContract<
  M extends Method = Method,
  P extends string = string,
  Q extends Schema = Schema,
  B extends Schema = Schema,
  R extends Schema = Schema,
> = { readonly method: M; readonly path: P; readonly query: Q; readonly body: B; readonly response: R };
export type RouteMap = Record<string, RouteContract>;

export interface BaseCtx {
  readonly req: Request;
  readonly url: URL;
  readonly requestId: string;
  readonly log: Logger;
}

/** Middleware returns the props it adds to the context. Throw to abort. */
export type Middleware<In extends object, Add extends object> = (ctx: In) => Awaitable<Add>;

type ParamNames<P extends string> = P extends `${string}:${infer N}/${infer Rest}`
  ? N | ParamNames<`/${Rest}`>
  : P extends `${string}:${infer N}`
    ? N
    : never;

/** "/users/:id/posts/:postId" -> { id: string; postId: string } */
export type PathParams<P extends string> = { [K in ParamNames<P>]: string };

type Schema = z.ZodType | undefined;
type Out<S extends Schema> = S extends z.ZodType ? z.output<S> : undefined;
type In<S extends Schema> = S extends z.ZodType ? z.input<S> : unknown;

export interface RouteDef<Ctx extends BaseCtx, Path extends string, Q extends Schema, B extends Schema, R extends Schema> {
  query?: Q;
  body?: B;
  /** If set, the handler's return value is type-checked AND validated at runtime. */
  response?: R;
  handler: (ctx: Ctx & { params: PathParams<Path>; query: Out<Q>; body: Out<B> }) => Awaitable<In<R> | Response>;
}

interface Route {
  method: Method;
  path: string;
  segments: string[];
  query?: z.ZodType;
  body?: z.ZodType;
  response?: z.ZodType;
  run: (base: BaseCtx, params: Record<string, string>) => Promise<unknown>;
}

interface State {
  prefix: string;
  middlewares: Middleware<any, any>[]; // erased internally, strictly typed at the public API
  routes: Route[];
  log: Logger;
}

/* ---------- Router ---------- */

export class Router<Ctx extends BaseCtx = BaseCtx, Routes extends RouteMap = {}, Prefix extends string = ""> {
  readonly #s: State;
  private constructor(state: State) {
    this.#s = state;
  }

  static create(opts: { log?: Logger } = {}): Router<BaseCtx, {}, ""> {
    return new Router({ prefix: "", middlewares: [], routes: [], log: opts.log ?? createLogger() });
  }

  /** Adds a middleware. Applies to routes registered on the returned router. */
  use<Add extends object>(mw: Middleware<Ctx, Add>): Router<Ctx & Add, Routes, Prefix> {
    return new Router<Ctx & Add, Routes, Prefix>({ ...this.#s, middlewares: [...this.#s.middlewares, mw] });
  }

  /** Same routes table, new path prefix. */
  group<Group extends string>(prefix: Group): Router<Ctx, Routes, `${Prefix}${Group}`> {
    return new Router<Ctx, Routes, `${Prefix}${Group}`>({ ...this.#s, prefix: this.#s.prefix + prefix });
  }

  get = this.#method("GET");
  post = this.#method("POST");
  put = this.#method("PUT");
  patch = this.#method("PATCH");
  delete = this.#method("DELETE");

  #method(method: Method) {
    return <Path extends string, Q extends Schema = undefined, B extends Schema = undefined, R extends Schema = undefined>(
      path: Path,
      def: RouteDef<Ctx, Path, Q, B, R>,
    ): Router<
      Ctx,
      Routes & Record<`${typeof method} ${Prefix}${Path}`, RouteContract<typeof method, `${Prefix}${Path}`, Q, B, R>>,
      Prefix
    > => {
      const mws = this.#s.middlewares;
      const fullPath = this.#s.prefix + path;
      this.#s.routes.push({
        method,
        path: fullPath,
        segments: split(fullPath),
        ...(def.query ? { query: def.query } : {}),
        ...(def.body ? { body: def.body } : {}),
        ...(def.response ? { response: def.response } : {}),
        run: async (base, params) => {
          let ctx: any = base;
          for (const mw of mws) ctx = { ...ctx, ...(await mw(ctx)) };
          const query = def.query ? parse(def.query, Object.fromEntries(base.url.searchParams)) : undefined;
          const body = def.body ? parse(def.body, await readJson(base.req)) : undefined;
          const out = await def.handler({ ...ctx, params, query, body });
          return def.response && !(out instanceof Response) ? parse(def.response, out) : out;
        },
      });
      return this as Router<
        Ctx,
        Routes & Record<`${typeof method} ${Prefix}${Path}`, RouteContract<typeof method, `${Prefix}${Path}`, Q, B, R>>,
        Prefix
      >;
    };
  }

  /** Build an OpenAPI 3.1 document directly from the registered route schemas. */
  openAPI(opts: { title?: string; version?: string } = {}): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const route of this.#s.routes) {
      const path = route.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const operation: Record<string, unknown> = {
        responses: route.response
          ? { "200": { description: "Successful response", content: { "application/json": { schema: z.toJSONSchema(route.response) } } } }
          : { "204": { description: "No content" } },
      };
      if (route.query) operation.parameters = queryParameters(route.query);
      if (route.body) {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema: z.toJSONSchema(route.body) } },
        };
      }

      const pathParameters = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
        name: match[1],
        in: "path",
        required: true,
        schema: { type: "string" },
      }));
      if (pathParameters.length) operation.parameters = [...((operation.parameters as unknown[]) ?? []), ...pathParameters];
      (paths[path] ??= {})[route.method.toLowerCase()] = operation;
    }
    return {
      openapi: "3.1.0",
      info: { title: opts.title ?? "API", version: opts.version ?? "1.0.0" },
      paths,
    };
  }

  /** Validate a client response against the schema registered for its route. */
  validateResponse(method: Method, path: string, value: unknown): unknown {
    const route = this.#s.routes.find((entry) => entry.method === method && entry.path === path);
    if (!route) throw new Error(`Route contract not found: ${method} ${path}`);
    return route.response ? parse(route.response, value) : value;
  }

  /** Plug straight into Bun.serve({ fetch: router.fetch }). */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const log = this.#s.log.child({ requestId });
    const started = performance.now();
    let res: Response;

    try {
      const segs = split(url.pathname);
      let pathMatched = false;
      let found: { route: Route; params: Record<string, string> } | undefined;

      for (const route of this.#s.routes) {
        const params = match(route.segments, segs);
        if (!params) continue;
        pathMatched = true;
        if (route.method === req.method) {
          found = { route, params };
          break;
        }
      }

      if (!found) throw pathMatched ? new HttpError(405, "Method Not Allowed") : HttpError.notFound();
      const out = await found.route.run({ req, url, requestId, log }, found.params);
      res = out instanceof Response ? out : out === undefined ? new Response(null, { status: 204 }) : Response.json(out);
    } catch (e) {
      res = toErrorResponse(e, log);
    }

    res.headers.set("x-request-id", requestId);
    log.info("request", { method: req.method, path: url.pathname, status: res.status, ms: Math.round(performance.now() - started) });
    return res;
  };
}

/* ---------- Helpers ---------- */

const split = (p: string) => p.split("/").filter(Boolean);

function match(pattern: string[], actual: string[]): Record<string, string> | null {
  if (pattern.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i]!;
    const a = actual[i]!;
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(a);
    else if (p !== a) return null;
  }
  return params;
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw HttpError.badRequest("Invalid JSON body");
  }
}

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw HttpError.unprocessable("Validation failed", r.error.issues);
  return r.data;
}

function queryParameters(schema: z.ZodType): unknown[] {
  const jsonSchema = z.toJSONSchema(schema);
  const properties = typeof jsonSchema === "object" && jsonSchema !== null && "properties" in jsonSchema
    ? jsonSchema.properties
    : undefined;
  if (!properties || typeof properties !== "object") return [];
  const required = new Set(
    typeof jsonSchema === "object" && jsonSchema !== null && "required" in jsonSchema && Array.isArray(jsonSchema.required)
      ? jsonSchema.required
      : [],
  );
  return Object.entries(properties).map(([name, value]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: value,
  }));
}

function toErrorResponse(e: unknown, log: Logger): Response {
  if (e instanceof HttpError) {
    const retryAfterMs = e.status === 429 && typeof e.details === "object" && e.details !== null && "retryAfterMs" in e.details
      ? Number(e.details.retryAfterMs)
      : undefined;
    const headers = retryAfterMs !== undefined && Number.isFinite(retryAfterMs)
      ? { "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
      : undefined;
    return Response.json(
      { error: { message: e.message, details: e.details } },
      headers ? { status: e.status, headers } : { status: e.status },
    );
  }
  log.error("unhandled", { error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e) });
  return Response.json({ error: { message: "Internal Server Error" } }, { status: 500 });
}
