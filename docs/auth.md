# Authentication guide

The checked example is [`snippets/auth.ts`](./snippets/auth.ts).

## JWT and bearer authentication

**What it does:** `signJwt()` and `verifyJwt()` create and validate typed
HS256 tokens using Web Crypto. `bearerAuth()` verifies a bearer token and adds
its validated user to route context.

**When to use it:** Use short-lived signed tokens for stateless API
authentication when you can manage signing secrets and expiry.

**Example:**

```ts
import { z } from "zod";
import { signJwt, verifyJwt } from "@2hasan2/bunker/auth";

const secret = "development-only-example";
const userSchema = z.object({ id: z.string(), role: z.enum(["admin", "user"]) });
const token = await signJwt({ id: "u1", role: "user" }, secret, { expiresInSeconds: 900 });
const user = token.ok
  ? await verifyJwt(token.value, secret, userSchema)
  : token;
void user;
```

**Gotchas:** Validate the payload with a Zod schema and keep secrets outside
source control. JWT revocation requires additional state or short expiry.

## Password hashing

**What it does:** `hashPassword()` and `verifyPassword()` wrap Bun's built-in
password hashing and return `Result` values.

**When to use it:** Use these functions for password credentials; never store
plaintext passwords or use a fast general-purpose hash.

**Example:** The checked auth snippet shows the `hashPassword()` call.

**Gotchas:** These functions require Bun's `Bun.password` runtime API and may
fail; inspect the returned `Result` before using its value.

## Roles

**What it does:** `parseRole()` validates the `ROLE` setting, `startRole()`
starts role-specific tasks, and `requireRole()` rejects requests unless the
authenticated user's role matches.

**When to use it:** Split web and worker responsibilities across deployments
without maintaining separate application code.

**Example:**

```ts
import { requireRole } from "@2hasan2/bunker/auth";
import { bearerAuth, Router } from "@2hasan2/bunker/http";

const authenticate = bearerAuth(async () => ({ id: "u1", role: "admin" }));
const adminApi = Router.create()
  .use(authenticate)
  .use(requireRole<"admin", { id: string; role: string }>("admin"))
  .get("/admin", { handler: ({ user }) => ({ id: user.id, role: user.role }) });
```

**Gotchas:** `requireRole()` belongs after authentication middleware. Roles
are authorization checks, not a substitute for resource-level access checks.
