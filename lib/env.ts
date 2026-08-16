// Global Dograh credentials are development/bootstrap fallback only. Production
// tenant traffic resolves organization-scoped credentials from runtime_connections.
export function hasDograhEnv() {
  return Boolean(process.env.DOGRAH_BASE_URL && process.env.DOGRAH_API_KEY);
}

export function requireDograhDevFallbackEnv() {
  const baseUrl = process.env.DOGRAH_BASE_URL;
  const apiKey = process.env.DOGRAH_API_KEY;
  if (!baseUrl || !apiKey) throw new Error("DOGRAH_NOT_CONFIGURED");
  return { baseUrl, apiKey };
}
