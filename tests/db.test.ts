import { describe, expect, it } from "vitest";
import { databaseConnectionString } from "@/lib/db";

describe("database connection security", () => {
  it("forces verify-full in production even when the provider URL says require", () => {
    const value = databaseConnectionString("postgresql://user:pass@example.neon.tech/db?sslmode=require", true);
    const url = new URL(value);
    expect(url.searchParams.get("sslmode")).toBe("verify-full");
    expect(url.searchParams.has("uselibpqcompat")).toBe(false);
  });

  it("does not rewrite local development URLs", () => {
    const raw = "postgresql://localhost:5432/youragent";
    expect(databaseConnectionString(raw, false)).toBe(raw);
  });
});
