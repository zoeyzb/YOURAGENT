import { createHash } from "node:crypto";
import { createNeonAuth } from "@neondatabase/auth/next/server";

const DEFAULT_NEON_AUTH_BASE_URL = "https://ep-misty-credit-ayv01ntp.neonauth.c-5.us-east-2.aws.neon.tech/neondb/auth";

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

export const auth = createNeonAuth({
  baseUrl: process.env.NEON_AUTH_BASE_URL ?? DEFAULT_NEON_AUTH_BASE_URL,
  cookies: {
    secret: resolveCookieSecret(),
  },
  logLevel: process.env.NODE_ENV === "production" ? "warn" : "info",
});
