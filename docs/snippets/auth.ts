import { z } from "zod";
import { hashPassword, parseRole, requireRole, signJwt, verifyJwt } from "@2hasan2/bunker/auth";

const claims = z.object({ id: z.string(), role: z.enum(["admin", "user"]) });
const user = { id: "user-1", role: "admin" as const };
const token = await signJwt(user, "development-secret", { expiresInSeconds: 900 });
const verified = token.ok
  ? await verifyJwt(token.value, "development-secret", claims)
  : token;
const hash = await hashPassword("example-password");
const role = parseRole("web");
const adminOnly = requireRole<"admin", typeof user>("admin");

void [verified, hash, role, adminOnly];
