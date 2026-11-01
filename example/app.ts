import { z } from "zod";
import { Router, type BaseCtx, Emitter, HttpError, bearerAuth, createLogger, defineEnv, serve, withCors, ok, err, type Result } from "../src";

const env = defineEnv({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const log = createLogger({ level: env.LOG_LEVEL });

/* ---- domain (framework-free) ---- */
const User = z.object({ id: z.string(), name: z.string(), email: z.email() });
type User = z.infer<typeof User>;
const db = new Map<string, User>();

const createUser = (input: Omit<User, "id">): Result<User, "email_taken"> => {
  if ([...db.values()].some((u) => u.email === input.email)) return err("email_taken");
  const user = { id: crypto.randomUUID(), ...input };
  db.set(user.id, user);
  return ok(user);
};

const events = new Emitter<{ "user.created": User }>();
events.on("user.created", (u) => log.info("welcome email queued", { to: u.email })); // payload typed

/* ---- modules: a module is just a function taking a router ---- */
const usersModule = <C extends BaseCtx>(r: Router<C>) => {
  r.post("/users", {
    body: z.object({ name: z.string().min(1), email: z.email() }),
    response: User,
    handler: async ({ body }) => {
      const res = createUser(body); // body is { name: string; email: string }
      if (!res.ok) throw HttpError.conflict(res.error);
      await events.emit("user.created", res.value);
      return res.value;
    },
  });

  r.get("/users/:id", {
    response: User,
    handler: ({ params }) => {
      // params.id: string  (derived from the path literal)
      const user = db.get(params.id);
      if (!user) throw HttpError.notFound("User not found");
      return user;
    },
  });

  r.get("/users", {
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }),
    handler: ({ query }) => [...db.values()].slice(0, query.limit),
  });
};

/* ---- composition ---- */
const app = Router.create({ log });
usersModule(app.group("/api"));

const authed = app.use(bearerAuth(async (t) => (t === "secret" ? { id: "admin", role: "admin" as const } : null)));
authed.get("/api/me", { handler: ({ user }) => user }); // user: { id: string; role: "admin" }

serve(withCors(app.fetch), { port: env.PORT });
log.info("listening", { port: env.PORT });
