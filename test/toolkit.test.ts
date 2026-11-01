import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  createCache,
  createClient,
  createHttpClient,
  createQueue,
  createRepository,
  createTestApp,
  createScheduler,
  createShutdown,
  defineJob,
  healthRoutes,
  MemoryCacheStore,
  MemoryQueueStore,
  MemoryRateLimitStore,
  createRequestMetrics,
  metricsRoute,
  RedisCacheStore,
  RedisLock,
  RedisRateLimitStore,
  createRedisPubSub,
  MemoryServiceRegistry,
  MemoryServiceTransport,
  createMemoryServiceFetcher,
  RedisServiceRegistry,
  composeApps,
  createDiscoveredClient,
  createServiceClient,
  withIdempotency,
  openAPIDocs,
  openDatabase,
  createDrizzleDatabase,
  migrateDatabase,
  paginateArray,
  parseUploads,
  rateLimit,
  Router,
  bearerAuth,
  requireRole,
  signJwt,
  verifyJwt,
  serveTcpService,
  type RedisClient,
} from "../src";
import { users as drizzleUsers, schema as drizzleSchema } from "../example/db/schema";

class SharedFakeRedis implements RedisClient {
  readonly values = new Map<string, string>();
  readonly listeners = new Map<string, Set<(message: string) => void>>();
  readonly sorted = new Map<string, Map<string, number>>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string, options: { PX: number; NX?: boolean }) {
    if (options.NX && this.values.has(key)) return null;
    this.values.set(key, value);
    return "OK";
  }

  async del(key: string) {
    return Number(this.values.delete(key));
  }

  async eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown> {
    const [key] = options.keys;
    if (!key) throw new Error("Missing Redis key");
    if (script.includes("ZREMRANGEBYSCORE")) {
      const entries = this.sorted.get(key) ?? new Map();
      const now = Number(options.arguments[0]);
      for (const [member, score] of entries) if (score <= now) entries.delete(member);
      this.sorted.set(key, entries);
      return [...entries].filter(([, score]) => score >= now).map(([member]) => member);
    }
    if (script.includes("redis.call('ZADD', KEYS[1], ARGV[1], ARGV[2])")) {
      const entries = this.sorted.get(key) ?? new Map();
      entries.set(options.arguments[1]!, Number(options.arguments[0]));
      this.sorted.set(key, entries);
      return 1;
    }
    if (script.includes("redis.call('ZREM', KEYS[1], ARGV[1])")) {
      return Number(this.sorted.get(key)?.delete(options.arguments[0]!) ?? false);
    }
    const current = this.values.get(key);
    if (script.includes("local value = redis.call('INCR'")) {
      const count = Number(current ?? 0) + 1;
      this.values.set(key, String(count));
      return script.includes("PTTL") ? [count, Number(options.arguments[0])] : count;
    }
    if (script.includes("redis.call('GET', KEYS[1]) ~= ARGV[1]")) {
      if (current !== options.arguments[0]) return 0;
      this.values.set(key, options.arguments[1]!);
      return 1;
    }
    if (script.includes("redis.call('GET', KEYS[1]) == ARGV[1]")) {
      if (current !== options.arguments[0]) return 0;
      this.values.delete(key);
      return 1;
    }
    throw new Error("Unexpected fake Redis script");
  }

  async publish(channel: string, message: string) {
    for (const listener of this.listeners.get(channel) ?? []) listener(message);
    return this.listeners.get(channel)?.size ?? 0;
  }

  async subscribe(channel: string, listener: (message: string) => void) {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  async unsubscribe(channel: string) {
    this.listeners.delete(channel);
  }
}

describe("database repository", () => {
  it("returns Result values for validated CRUD operations", () => {
    const opened = openDatabase();
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const db = opened.value;
    try {
      db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)");
      const users = createRepository(db, {
        table: "users",
        schema: z.object({ id: z.string(), name: z.string() }),
      });
      expect(users.insert({ id: "u1", name: "Ada" })).toEqual({ ok: true, value: { id: "u1", name: "Ada" } });
      expect(users.get("u1")).toEqual({ ok: true, value: { id: "u1", name: "Ada" } });
      expect(users.update("u1", { name: "Grace" })).toEqual({ ok: true, value: { id: "u1", name: "Grace" } });
      expect(users.delete("u1")).toEqual({ ok: true, value: true });
      expect(users.get("u1")).toEqual({ ok: true, value: null });
    } finally {
      db.close();
    }
  });
});

describe("Drizzle database", () => {
  it("applies generated migrations and performs typed CRUD", () => {
    const client = new Database(":memory:", { strict: true });
    try {
      const db = createDrizzleDatabase(client, { schema: drizzleSchema });
      const migrationsFolder = fileURLToPath(new URL("../example/drizzle", import.meta.url));
      expect(migrateDatabase(db, migrationsFolder)).toEqual({ ok: true, value: undefined });
      expect(migrateDatabase(db, migrationsFolder)).toEqual({ ok: true, value: undefined });

      const inserted = db.insert(drizzleUsers).values({
        name: "Ada",
        email: "ada@example.com",
      }).returning().get();
      expect(inserted.name).toBe("Ada");
      expect(inserted.createdAt).toBeInstanceOf(Date);
      expect(db.select().from(drizzleUsers).all()).toEqual([inserted]);
    } finally {
      client.close();
    }
  });
});

describe("router integrations", () => {
  const userSchema = z.object({ id: z.string(), active: z.boolean() });
  const api = Router.create().group("/api").get("/users/:id", {
    query: z.object({ active: z.coerce.boolean() }),
    response: userSchema,
    handler: ({ params, query }) => ({ id: params.id, active: query.active }),
  }).post("/users", {
    body: z.object({ id: z.string(), active: z.boolean() }),
    response: userSchema,
    handler: ({ body }) => body,
  });

  it("tests handlers without opening a server", async () => {
    const app = createTestApp(api);
    const response = await app.req.get("/api/users/a?active=true");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "a", active: true });
  });

  it("returns 400 for malformed path parameter encoding", async () => {
    const response = await createTestApp(api).req.get("/api/users/%E0%A4%A?active=true");
    expect(response.status).toBe(400);
  });

  it("infers client route inputs and validates responses", async () => {
    const client = createClient("http://localhost", api, {
      fetcher: (input, init) => api.fetch(new Request(String(input), init)),
    });
    if (false) {
      // @ts-expect-error path parameters are required for routes containing params
      void client.request("GET", "/api/users/:id");
      // @ts-expect-error body types are inferred from the route schema
      void client.request("POST", "/api/users", { body: { id: 1, active: false } });
    }
    const response = await client.request("GET", "/api/users/:id", {
      params: { id: "a b" },
      query: { active: true },
    });
    expect(response).toEqual({ ok: true, value: { id: "a b", active: true } });
    if (response.ok) {
      const inferredId: string = response.value.id;
      const inferredActive: boolean = response.value.active;
      expect([inferredId, inferredActive]).toEqual(["a b", true]);
    }
    const created = await client.request("POST", "/api/users", { body: { id: "new", active: false } });
    if (created.ok) expect(created.value.id).toBe("new");
  });

  it("generates OpenAPI and serves the docs page", async () => {
    const spec = api.openAPI({ title: "Test API", version: "2.0.0" });
    expect(spec).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Test API", version: "2.0.0" },
      paths: { "/api/users/{id}": { get: expect.any(Object) } },
    });
    const docs = openAPIDocs(api);
    expect((await docs(new Request("http://localhost/docs"))).headers.get("content-type")).toContain("text/html");
    expect((await docs(new Request("http://localhost/openapi.json"))).status).toBe(200);
  });

  it("composes independent apps under prefixes", async () => {
    const app = composeApps(Router.create(), [
      {
        prefix: "/catalog",
        register: (router) => router.get("/items", { handler: () => ({ service: "catalog" }) }),
      },
      {
        prefix: "/billing",
        register: (router) => router.get("/invoices", { handler: () => ({ service: "billing" }) }),
      },
    ]);
    const requests = createTestApp(app);
    expect(await (await requests.req.get("/catalog/items")).json()).toEqual({ service: "catalog" });
    expect(await (await requests.req.get("/billing/invoices")).json()).toEqual({ service: "billing" });
  });
});

describe("shared utilities", () => {
  it("caches values and returns a Result", async () => {
    const cache = createCache(new MemoryCacheStore());
    const result = await cache.wrap("key", 1000, () => ({ value: 1 }));
    expect(result).toEqual({ ok: true, value: { value: 1 } });
    const cached = await cache.wrap("key", 1000, () => ({ value: 2 }));
    expect(cached).toEqual({ ok: true, value: { value: 1 } });
  });

  it("validates cache values and coalesces concurrent cache misses", async () => {
    const store = new MemoryCacheStore();
    const cache = createCache(store);
    const schema = z.object({ value: z.number() });
    let loads = 0;
    const load = () => {
      loads++;
      return Bun.sleep(10).then(() => ({ value: 42 }));
    };
    const results = await Promise.all([
      cache.wrap("validated", 1_000, load, { schema, stampede: true }),
      cache.wrap("validated", 1_000, load, { schema, stampede: true }),
    ]);
    expect(results).toEqual([
      { ok: true, value: { value: 42 } },
      { ok: true, value: { value: 42 } },
    ]);
    expect(loads).toBe(1);

    await store.set("invalid", JSON.stringify({ value: "not a number" }), 1_000);
    const invalid = await cache.wrap("invalid", 1_000, () => ({ value: 1 }), { schema });
    expect(invalid.ok).toBe(false);
  });

  it("paginates arrays with opaque cursors", () => {
    const first = paginateArray([1, 2, 3], { limit: 2 });
    expect(first).toEqual({ ok: true, value: { items: [1, 2], nextCursor: expect.any(String) } });
    if (!first.ok || !first.value.nextCursor) return;
    expect(paginateArray([1, 2, 3], { limit: 2, cursor: first.value.nextCursor })).toEqual({
      ok: true,
      value: { items: [3], nextCursor: null },
    });
  });

  it("signs and verifies schema-validated JWT payloads", async () => {
    const schema = z.object({ sub: z.string(), exp: z.number() });
    const token = await signJwt({ sub: "user-1" }, "test-secret", { expiresInSeconds: 30 });
    expect(token.ok).toBe(true);
    if (!token.ok) return;
    expect(await verifyJwt(token.value, "test-secret", schema)).toMatchObject({
      ok: true,
      value: { sub: "user-1" },
    });
    expect((await verifyJwt(token.value, "wrong-secret", schema)).ok).toBe(false);
  });

  it("limits requests using an explicit key resolver", async () => {
    const api = Router.create()
      .use(rateLimit({
        limit: 1,
        windowMs: 60_000,
        store: new MemoryRateLimitStore(),
        key: ({ req }) => req.headers.get("x-client") ?? "unknown",
      }))
      .get("/limited", { handler: () => ({ status: "ok" }) });
    const app = createTestApp(api);
    const headers = { "x-client": "client-1" };
    expect((await app.req.get("/limited", { headers })).status).toBe(200);
    const limited = await app.req.get("/limited", { headers });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("checks roles at the HTTP boundary and retains user fields", async () => {
    const api = Router.create()
      .use(bearerAuth(async (token) => ({ id: "u1", role: token === "admin" ? "admin" : "member" })))
      .use(requireRole("admin"))
      .get("/admin", { handler: ({ user }) => ({ id: user.id, role: user.role }) });
    const app = createTestApp(api);
    const allowed = await app.req.get("/admin", { headers: { authorization: "Bearer admin" } });
    expect(await allowed.json()).toEqual({ id: "u1", role: "admin" });
    expect((await app.req.get("/admin", { headers: { authorization: "Bearer member" } })).status).toBe(403);
  });

  it("reports failed readiness checks and drains handlers before cleanup", async () => {
    const api = Router.create();
    healthRoutes(api, { checks: { database: () => false } });
    expect((await createTestApp(api).req.get("/ready")).status).toBe(503);

    const shutdown = createShutdown({ timeoutMs: 1000 });
    let cleaned = false;
    shutdown.register(() => { cleaned = true; });
    let release!: () => void;
    const inFlight = shutdown.wrap(() => new Promise<Response>((resolve) => {
      release = () => resolve(new Response("done"));
    }));
    const request = inFlight(new Request("http://localhost/"));
    await Promise.resolve();
    const stopping = shutdown.shutdown("test");
    release();
    expect((await request).status).toBe(200);
    expect((await stopping).ok).toBe(true);
    expect(cleaned).toBe(true);
    expect((await inFlight(new Request("http://localhost/"))).status).toBe(503);

    const readiness = Router.create();
    healthRoutes(readiness, { isDraining: () => shutdown.isDraining });
    expect((await createTestApp(readiness).req.get("/ready")).status).toBe(503);
  });

  it("validates job payloads, enqueues scheduled work, and runs its handler", async () => {
    let handled = false;
    const job = defineJob("test-job", z.object({ id: z.string() }), () => { handled = true; });
    const queueStore = new MemoryQueueStore();
    const queued = await createQueue(queueStore).enqueue(job, { id: "visibility" });
    expect(queued.ok).toBe(true);
    const claim = await queueStore.claim(Date.now(), 1);
    expect(claim?.payload).toEqual({ id: "visibility" });
    expect((await queueStore.claim(Date.now() + 2, 1))?.id).toBe(claim?.id);

    await queueStore.remove(claim!.id);
    const queue = createQueue(queueStore, { pollMs: 5, onError: (error) => { throw error; } });
    const locks = new Map<string, number>();
    const scheduler = createScheduler(queue, {
      acquire: async (key, ttlMs) => {
        const now = Date.now();
        if ((locks.get(key) ?? 0) > now) return null;
        locks.set(key, now + ttlMs);
        return { release: async () => { locks.delete(key); } };
      },
    });
    const otherScheduler = createScheduler(createQueue(queueStore), {
      acquire: async (key, ttlMs) => {
        const now = Date.now();
        if ((locks.get(key) ?? 0) > now) return null;
        locks.set(key, now + ttlMs);
        return { release: async () => { locks.delete(key); } };
      },
    });
    expect(scheduler.add("* * * * *", job, { id: "1" }).ok).toBe(true);
    expect(otherScheduler.add("* * * * *", job, { id: "1" }).ok).toBe(true);
    const scheduled = await scheduler.tick(new Date(Date.UTC(2026, 0, 1, 0, 0)));
    expect(scheduled).toBeUndefined();
    await otherScheduler.tick(new Date(Date.UTC(2026, 0, 1, 0, 0)));
    const worker = queue.start([job]);
    await Bun.sleep(20);
    await worker.stop();
    expect(handled).toBe(true);
  });

  it("retries safe HTTP requests and enforces multipart limits", async () => {
    let attempts = 0;
    const http = createHttpClient({
      retries: 1,
      retryDelayMs: 0,
      fetcher: async () => ++attempts === 1
        ? new Response("temporary", { status: 503 })
        : Response.json({ value: 7 }),
    });
    expect(await http.request("http://service.test", z.object({ value: z.number() }))).toEqual({
      ok: true,
      value: { value: 7 },
    });
    expect(attempts).toBe(2);

    const form = new FormData();
    form.append("note", "hello");
    form.append("file", new File(["data"], "sample.txt", { type: "text/plain" }));
    const request = new Request("http://localhost/upload", { method: "POST", body: form });
    const uploaded = await parseUploads(request, { maxBytes: 1024, allowedTypes: ["text/plain"] });
    expect(uploaded.ok).toBe(true);
    if (uploaded.ok) expect(uploaded.value.files).toHaveLength(1);
  });

  it("replays idempotent responses and rejects key reuse with a different body", async () => {
    const store = new MemoryCacheStore();
    let executions = 0;
    const handler = withIdempotency(async (request) => {
      executions++;
      return Response.json({ id: "created", requestId: request.headers.get("x-request-id") }, { status: 201 });
    }, store);
    const makeRequest = (body: string) => new Request("http://localhost/items", {
      method: "POST",
      headers: { "idempotency-key": "request-1", "content-type": "application/json" },
      body,
    });
    const first = await handler(makeRequest('{"name":"one"}'));
    const replay = await handler(makeRequest('{"name":"one"}'));
    const conflict = await handler(makeRequest('{"name":"two"}'));
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(await replay.json()).toMatchObject({ id: "created" });
    expect(first.headers.get("x-request-id")).not.toBe(replay.headers.get("x-request-id"));
    expect(conflict.status).toBe(409);
    expect(executions).toBe(1);
  });

  it("uses atomic Redis-compatible operations for cache, rate limits, locks, and pub/sub", async () => {
    const redis = new SharedFakeRedis();
    const cacheA = new RedisCacheStore(redis);
    const cacheB = new RedisCacheStore(redis);
    expect(await cacheA.setIfAbsent("shared", "one", 1000)).toBe(true);
    expect(await cacheB.setIfAbsent("shared", "two", 1000)).toBe(false);
    expect(await cacheB.compareAndSet("shared", "one", "three", 1000)).toBe(true);
    expect(await cacheA.increment("counter", 1000)).toBe(1);
    expect(await cacheB.increment("counter", 1000)).toBe(2);

    const locksA = new RedisLock(redis);
    const locksB = new RedisLock(redis);
    const lease = await locksA.acquire("migration", 1000);
    expect(lease).not.toBeNull();
    expect(await locksB.acquire("migration", 1000)).toBeNull();
    await lease?.release();
    expect(await locksB.acquire("migration", 1000)).not.toBeNull();

    const rateA = new RedisRateLimitStore(redis);
    const rateB = new RedisRateLimitStore(redis);
    expect((await rateA.increment("client", 1000, 100)).count).toBe(1);
    expect((await rateB.increment("client", 1000, 100)).count).toBe(2);

    const schema = { event: z.object({ value: z.string() }) };
    const pubsub = createRedisPubSub(redis, redis, schema);
    let received = "";
    const unsubscribe = await pubsub.subscribe("event", ({ value }) => { received = value; });
    await pubsub.publish("event", { value: "shared" });
    expect(received).toBe("shared");
    await unsubscribe();
  });

  it("exports per-instance request metrics", async () => {
    const metrics = createRequestMetrics("instance-test");
    const api = Router.create().get("/metric-test", { handler: () => ({ ok: true }) });
    metricsRoute(api, metrics);
    const app = metrics.wrap(api.fetch);
    await app(new Request("http://localhost/metric-test"));
    const output = metrics.prometheus();
    expect(output).toContain('instance="instance-test"');
    expect(output).toContain('method="GET",status="200"');
    expect((await createTestApp(api).req.get("/metrics")).headers.get("content-type")).toContain("text/plain");
  });

  it("discovers memory and Redis registered services and routes to them", async () => {
    const localRegistry = new MemoryServiceRegistry();
    const transport = new MemoryServiceTransport();
    const app = Router.create().get("/hello", { handler: () => ({ service: "memory" }) });
    const unregister = transport.register("greeter", app.fetch);
    const registration = await localRegistry.register({
      name: "greeter",
      instanceId: "local-1",
      endpoint: "http://127.0.0.1:3100",
      transport: "http",
    });
    const localClient = createMemoryServiceFetcher(transport, "greeter");
    expect((await localRegistry.discover("greeter")).map((instance) => instance.instanceId)).toEqual(["local-1"]);
    expect(await (await localClient("http://local/hello")).json()).toEqual({ service: "memory" });
    await registration.close();
    unregister();

    const httpServer = Bun.serve({ port: 0, fetch: app.fetch });
    try {
      const httpRegistry = new MemoryServiceRegistry();
      const httpRegistration = await httpRegistry.register({
        name: "catalog",
        instanceId: "catalog-1",
        endpoint: `http://127.0.0.1:${httpServer.port}`,
        transport: "http",
      });
      const serviceClient = createServiceClient(httpRegistry, "catalog");
      expect(await (await serviceClient.fetch(new Request("http://catalog/hello"))).json()).toEqual({ service: "memory" });

      const contract = Router.create().get("/hello", {
        response: z.object({ service: z.string() }),
        handler: () => ({ service: "memory" }),
      });
      const typedClient = createDiscoveredClient(httpRegistry, "catalog", contract);
      expect(await typedClient.request("GET", "/hello")).toEqual({
        ok: true,
        value: { service: "memory" },
      });
      await httpRegistration.close();
    } finally {
      httpServer.stop(true);
    }

    const redis = new SharedFakeRedis();
    const redisRegistry = new RedisServiceRegistry(redis);
    const remote = {
      name: "inventory",
      instanceId: "inventory-1",
      endpoint: "http://127.0.0.1:3200",
      transport: "http" as const,
    };
    const lease = await redisRegistry.register(remote, { ttlMs: 3000, heartbeatMs: 1000 });
    expect(await redisRegistry.discover("inventory")).toEqual([remote]);
    await lease.refresh();
    await lease.close();
    expect(await redisRegistry.discover("inventory")).toEqual([]);
  });

  it("calls a service over length-prefixed raw TCP", async () => {
    const app = Router.create().post("/echo", {
      body: z.object({ message: z.string() }),
      handler: ({ body }) => ({ echoed: body.message }),
    });
    const server = await serveTcpService(app.fetch, { host: "127.0.0.1", port: 0 });
    try {
      const registry = new MemoryServiceRegistry();
      const registration = await registry.register({
        name: "echo",
        instanceId: "echo-1",
        endpoint: `tcp://127.0.0.1:${server.port}`,
        transport: "tcp",
      });
      const client = createServiceClient(registry, "echo");
      const response = await client.fetch(new Request("http://echo/echo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "hello" }),
      }));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ echoed: "hello" });
      await registration.close();
    } finally {
      await server.close();
    }
  });
});
