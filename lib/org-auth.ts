import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function requireOrganizationAdmin(organizationId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error("UNAUTHENTICATED");

  const { data: membership, error: membershipError } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership || !["owner", "admin"].includes(membership.role)) throw new Error("FORBIDDEN");

  return { supabase, user: auth.user, role: membership.role };
}

export function organizationAuthErrorStatus(message: string) {
  if (message === "UNAUTHENTICATED") return 401;
  if (message === "FORBIDDEN") return 403;
  if (message === "SUPABASE_NOT_CONFIGURED") return 503;
  return 500;
}
