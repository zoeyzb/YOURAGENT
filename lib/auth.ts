import { createHash } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";

const BUILD_ONLY_NEON_AUTH_URL = "https://build-only.invalid/auth";

export function deriveNeonAuthBaseUrl(databaseUrl: string) {
  const database = new URL(databaseUrl);
  const hostParts = database.hostname.split(".");
  const endpoint = hostParts[0]?.replace(/-pooler$/, "");
  if (!endpoint?.startsWith("ep-") || hostParts.length < 2) {
    throw new Error("DATABASE_URL is not a supported Neon connection URL");
  }
  const databaseName = database.pathname.replace(/^\//, "") || "neondb";
  const suffix = hostParts.slice(1).join(".");
  return `https://${endpoint}.neonauth.${suffix}/${encodeURIComponent(databaseName)}/auth`;
}

function resolveAuthBaseUrl() {
  if (process.env.NEON_AUTH_BASE_URL) return process.env.NEON_AUTH_BASE_URL;
  if (process.env.DATABASE_URL) return deriveNeonAuthBaseUrl(process.env.DATABASE_URL);
  return BUILD_ONLY_NEON_AUTH_URL;
}

function resolveCookieSecret() {
  if (process.env.NEON_AUTH_COOKIE_SECRET) return process.env.NEON_AUTH_COOKIE_SECRET;
  if (process.env.DATABASE_URL) {
    return createHash("sha256")
      .update(`youragent-neon-auth-cookie:${process.env.DATABASE_URL}`)
      .digest("base64");
  }
  return "build-only-neon-auth-cookie-secret-not-valid-in-production";
}

export function hasAuthConfiguration() {
  return Boolean(process.env.DATABASE_URL);
}

const managedAuth = createNeonAuth({
  baseUrl: resolveAuthBaseUrl(),
  cookies: {
    secret: resolveCookieSecret(),
  },
  logLevel: process.env.NODE_ENV === "production" ? "warn" : "info",
});

export const auth = Object.assign(managedAuth, {
  api: {
    async getSession(_options?: { headers?: Headers }) {
      const { data } = await managedAuth.getSession();
      return data;
    },
  },
});
