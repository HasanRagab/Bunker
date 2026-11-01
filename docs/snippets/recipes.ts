import { Database } from "bun:sqlite";
import { z } from "zod";
import { createShutdown } from "@2hasan2/bunker/ops";
import { createQueue, defineJob, memoryDrivers, withIdempotency } from "@2hasan2/bunker/infra";
import { createScheduler } from "@2hasan2/bunker/infra";
import { requireRole } from "@2hasan2/bunker/auth";
import { bearerAuth, createClient, rateLimit, Router, type BaseCtx } from "@2hasan2/bunker/http";

const user = { id: "u1", role: "admin" };
const authenticate = bearerAuth(async () => user);
const adminApi = Router.create()
  .use(authenticate)
  .use(requireRole<"admin", typeof user>("admin"))
  .get("/admin", { handler: ({ user: currentUser }) => ({ id: currentUser.id, role: currentUser.role }) });

const drivers = memoryDrivers();
const userRateLimit = rateLimit<BaseCtx & { user: typeof user }>({
  limit: 60,
  windowMs: 60_000,
  store: drivers.rateLimit,
  key: (context) => context.user.id,
});
const limitedApi = Router.create().use(authenticate).use(userRateLimit);

const cleanupJob = defineJob("cleanup", z.object({}), async () => {});
const queue = createQueue(drivers.queue);
const scheduler = createScheduler(queue, drivers.lock);
const scheduled = scheduler.add("0 * * * *", cleanupJob, {});

const idempotentFetch = withIdempotency(adminApi.fetch, drivers.idempotency);
const contract = Router.create().get("/users/:id", {
  response: z.object({ id: z.string() }),
  handler: ({ params }) => ({ id: params.id }),
});
const client = createClient("https://api.example.test", contract);
const clientResult = await client.request("GET", "/users/:id", { params: { id: "u1" } });

const database = new Database(":memory:", { create: true, strict: true });
const shutdown = createShutdown({ timeoutMs: 20_000 });
shutdown.register(() => database.close());
const fetch = shutdown.wrap(adminApi.fetch);

void [limitedApi, scheduled, idempotentFetch, clientResult, fetch];
await drivers.close();
