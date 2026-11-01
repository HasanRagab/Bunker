import { createApp } from "@2hasan2/bunker";
import { defineEnv } from "@2hasan2/bunker/core";
import { defineModule } from "@2hasan2/bunker/http";
import { memoryDrivers } from "@2hasan2/bunker/infra";
import { z } from "zod";

const env = defineEnv({
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
});

const api = defineModule({
  name: "api",
  routes: (router) => router.get("/hello", {
    response: z.object({ message: z.string() }),
    handler: () => ({ message: "Hello from Bunker" }),
  }),
});

const app = createApp({
  env,
  drivers: memoryDrivers(),
  modules: [api],
  server: { port: env.PORT },
});

await app.start();
