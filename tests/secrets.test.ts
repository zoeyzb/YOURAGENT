import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hasRuntimeSecretEncryptionKey } from "@/lib/secrets";

const original = process.env.RUNTIME_SECRET_ENCRYPTION_KEY;

afterEach(() => {
  if (original === undefined) delete process.env.RUNTIME_SECRET_ENCRYPTION_KEY;
  else process.env.RUNTIME_SECRET_ENCRYPTION_KEY = original;
});

describe("runtime secret encryption", () => {
  it("round-trips with AES-256-GCM", () => {
    process.env.RUNTIME_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const packed = encryptSecret("dograh-secret-value");
    expect(packed).not.toContain("dograh-secret-value");
    expect(decryptSecret(packed)).toBe("dograh-secret-value");
  });

  it("rejects tampered ciphertext", () => {
    process.env.RUNTIME_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const packed = encryptSecret("protected");
    const parts = packed.split(".");
    parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith("A") ? "B" : "A");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("fails closed for invalid keys", () => {
    process.env.RUNTIME_SECRET_ENCRYPTION_KEY = "too-short";
    expect(hasRuntimeSecretEncryptionKey()).toBe(false);
    expect(() => encryptSecret("x")).toThrow("RUNTIME_SECRET_ENCRYPTION_KEY_INVALID");
  });
});
