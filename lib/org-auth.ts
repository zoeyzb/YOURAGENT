import { auth, hasAuthConfiguration } from "@/lib/auth";
import { hasDatabaseUrl, query } from "@/lib/db";

export async function requireOrganizationAdmin(organizationId: string, headers: Headers) {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) throw new Error("BACKEND_NOT_CONFIGURED");

  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error("UNAUTHENTICATED");

  const result = await query<{ role: string }>(
    `select role
       from organization_members
      where organization_id = $1
        and user_id = $2
      limit 1`,
    [organizationId, session.user.id],
  );
  const role = result.rows[0]?.role;
  if (!role || !["owner", "admin"].includes(role)) throw new Error("FORBIDDEN");

  return { user: session.user, role };
}

export async function requireOrganizationMember(organizationId: string, headers: Headers) {
  if (!hasAuthConfiguration() || !hasDatabaseUrl()) throw new Error("BACKEND_NOT_CONFIGURED");

  const session = await auth.api.getSession({ headers });
  if (!session?.user) throw new Error("UNAUTHENTICATED");

  const result = await query<{ role: string }>(
    `select role
       from organization_members
      where organization_id = $1
        and user_id = $2
      limit 1`,
    [organizationId, session.user.id],
  );
  const role = result.rows[0]?.role;
  if (!role) throw new Error("FORBIDDEN");

  return { user: session.user, role };
}

export function organizationAuthErrorStatus(message: string) {
  if (message === "UNAUTHENTICATED") return 401;
  if (message === "FORBIDDEN") return 403;
  if (message === "BACKEND_NOT_CONFIGURED" || message === "DATABASE_NOT_CONFIGURED") return 503;
  return 500;
}
