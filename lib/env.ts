export function hasSupabaseEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function requireSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }
  return { url, key };
}

export function hasSupabaseAdminEnv() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

export function requireSupabaseAdminEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_ADMIN_NOT_CONFIGURED");
  return { url, key };
}

// Global Dograh credentials are development/bootstrap fallback only. Production
// tenant traffic should resolve organization-scoped credentials from runtime_connections.
export function hasDograhEnv() {
  return Boolean(process.env.DOGRAH_BASE_URL && process.env.DOGRAH_API_KEY);
}

export function requireDograhDevFallbackEnv() {
  const baseUrl = process.env.DOGRAH_BASE_URL;
  const apiKey = process.env.DOGRAH_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("DOGRAH_NOT_CONFIGURED");
  return { baseUrl, apiKey };
}
