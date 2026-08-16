import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

const buildOnlyDatabaseUrl = "postgresql://build:build@127.0.0.1:5432/build";
const buildOnlySecret = "build-only-secret-that-is-never-valid-in-production";

export function hasAuthConfiguration() {
  return Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);
}

const authPool = new Pool({
  connectionString: process.env.DATABASE_URL ?? buildOnlyDatabaseUrl,
  ssl: process.env.DATABASE_URL && process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : undefined,
  options: process.env.DATABASE_URL ? "-c search_path=neon_auth,public" : undefined,
  max: 3,
});

export const auth = betterAuth({
  database: authPool,
  secret: process.env.BETTER_AUTH_SECRET ?? buildOnlySecret,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  plugins: [nextCookies()],
});
