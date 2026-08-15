import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAdminEnv } from "@/lib/env";

export function createSupabaseAdminClient() {
  const { url, key } = requireSupabaseAdminEnv();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
