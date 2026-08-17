import { createHash } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";

const DEFAULT_NEON_AUTH_BASE_URL = "https://ep-bold-unit-av7unor0.neonauth.c-11.us-east-1.aws.neon.tech/neondb/auth";

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
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? DEFAULT_NEON_AUTH_BASE_URL,
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
