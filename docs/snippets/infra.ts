import { z } from "zod";
import { createCache, defineJob, memoryDrivers } from "@2hasan2/bunker/infra";
import { createQueue } from "@2hasan2/bunker/infra";

const drivers = memoryDrivers();
const cache = createCache(drivers.cache);
const profile = await cache.wrap("profile:user-1", 30_000, async () => ({ id: "user-1" }), {
  schema: z.object({ id: z.string() }),
});

const cleanup = defineJob("cleanup", z.object({ olderThanDays: z.number() }), async ({ olderThanDays }) => {
  console.log(`Cleaning records older than ${olderThanDays} days`);
});
const queue = createQueue(drivers.queue);
const queued = await queue.enqueue(cleanup, { olderThanDays: 30 });

void [profile, queued];
await drivers.close();
