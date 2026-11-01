import { HttpError } from "./errors";
import type { BaseCtx } from "./http/router";
import type { Middleware } from "./http/router";

export function requireRole<Role extends string, User extends { role: string }>(
  role: Role,
): Middleware<BaseCtx & { user: User }, { user: User & { role: Role } }> {
  return ({ user }) => {
    if (user.role !== role) throw HttpError.forbidden("Insufficient role");
    return { user: user as User & { role: Role } };
  };
}

export function withSecurityHeaders(
  handler: (req: Request) => Promise<Response>,
  headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'",
  },
): (req: Request) => Promise<Response> {
  return async (req) => {
    const response = await handler(req);
    const output = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) output.headers.set(name, value);
    return output;
  };
}
