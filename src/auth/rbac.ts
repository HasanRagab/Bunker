import { HttpError } from "../core/errors";
import type { BaseCtx, Middleware } from "../http/router";

export function requireRole<Role extends string, User extends { role: string }>(
  role: Role,
): Middleware<BaseCtx & { user: User }, { user: User & { role: Role } }> {
  return ({ user }) => {
    if (user.role !== role) throw HttpError.forbidden("Insufficient role");
    return { user: user as User & { role: Role } };
  };
}
