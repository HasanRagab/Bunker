import { z } from "zod";
import {
  createHttpClient,
  createServiceClient,
  memoryServiceRegistry,
} from "@2hasan2/bunker/net";

const http = createHttpClient({
  timeoutMs: 2_000,
  retries: 2,
  requestId: () => crypto.randomUUID(),
});
const result = await http.request(
  "https://catalog.example.test/items/1",
  z.object({ id: z.string(), name: z.string() }),
);

if (result.ok) console.log(result.value.name);

const registry = memoryServiceRegistry();
const registration = await registry.register({
  name: "catalog",
  instanceId: "catalog-1",
  endpoint: "http://127.0.0.1:3001",
  transport: "http",
});
const catalog = createServiceClient(registry, "catalog");
const instances = await catalog.discover();
await registration.close();

void instances;
