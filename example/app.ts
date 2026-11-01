import { z } from "zod";
import {
  Emitter,
  HttpError,
  bearerAuth,
  createApp,
  createLogger,
  defineEnv,
  defineModule,
  err,
  memoryDrivers,
  ok,
  type Result,
} from "../src";

const env = defineEnv({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
const log = createLogger({ level: env.LOG_LEVEL });

const User = z.object({ id: z.string(), name: z.string(), email: z.email() });
type User = z.infer<typeof User>;
const db = new Map<string, User>();

const createUser = (input: Omit<User, "id">): Result<User, "email_taken"> => {
  if ([...db.values()].some((user) => user.email === input.email)) return err("email_taken");
  const user = { id: crypto.randomUUID(), ...input };
  db.set(user.id, user);
  return ok(user);
};

const events = new Emitter<{ "user.created": User }>();
events.on("user.created", (user) => log.info("welcome email queued", { to: user.email }));

const usersModule = defineModule({
  name: "users",
  prefix: "/api",
  routes: (router) =>
    router
      .post("/users", {
        body: z.object({ name: z.string().min(1), email: z.email() }),
        response: User,
        handler: async ({ body }) => {
          const result = createUser(body);
          if (!result.ok) throw HttpError.conflict(result.error);
          await events.emit("user.created", result.value);
          return result.value;
        },
      })
      .get("/users/:id", {
        response: User,
        handler: ({ params }) => {
          const user = db.get(params.id);
          if (!user) throw HttpError.notFound("User not found");
          return user;
        },
      })
      .get("/users", {
        query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
        handler: ({ query }) => [...db.values()].slice(0, query.limit),
      }),
});

const authModule = defineModule({
  name: "auth",
  prefix: "/api",
  routes: (router) =>
    router
      .use(bearerAuth(async (token) => (token === "secret" ? { id: "admin", role: "admin" as const } : null)))
      .get("/me", { handler: ({ user }) => user }),
});

const app = createApp({
  env,
  drivers: memoryDrivers({ logger: log }),
  modules: [usersModule, authModule],
  logger: log,
  cors: {},
});

await app.start();
log.info("listening", { port: env.PORT });
