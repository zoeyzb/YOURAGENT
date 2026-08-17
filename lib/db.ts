import { Pool, type PoolClient, type QueryResultRow } from "pg";

let pool: Pool | undefined;

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

export function databaseConnectionString(raw: string, production = process.env.NODE_ENV === "production") {
  if (!production) return raw;
  const url = new URL(raw);
  // Be explicit before pg/pg-connection-string change the meaning of
  // sslmode=require. Neon presents a publicly verifiable certificate, so
  // production should verify both the certificate chain and hostname.
  url.searchParams.set("sslmode", "verify-full");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

export function getDbPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_NOT_CONFIGURED");
  if (!pool) {
    pool = new Pool({
      connectionString: databaseConnectionString(process.env.DATABASE_URL),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
  return getDbPool().query<T>(text, values);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getDbPool().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
