import { createTestApp } from "@2hasan2/bunker";
import { verifyJwt } from "@2hasan2/bunker/auth";
import { defineEnv } from "@2hasan2/bunker/core";
import { bearerAuth, defineModule } from "@2hasan2/bunker/http";
import { z } from "zod";

const env = defineEnv({
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
}, { JWT_SECRET: "development-secret", PORT: "3000" });

const userSchema = z.object({ id: z.string(), role: z.enum(["admin", "user"]) });
const authenticate = bearerAuth(async (token) => {
  const result = await verifyJwt(token, env.JWT_SECRET, userSchema);
  return result.ok ? result.value : null;
});

const users = defineModule({
  name: "users",
  prefix: "/api",
  routes: (router) => router
    .use(authenticate)
    .get("/me", {
      response: userSchema,
      handler: ({ user }) => user,
    }),
});

const testApp = await createTestApp({ modules: [users], env });
const response = await testApp.req.get("/api/me");
console.log(response.status);
await testApp.stop();
