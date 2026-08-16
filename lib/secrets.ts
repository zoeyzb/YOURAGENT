import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function getKey() {
  const raw = process.env.RUNTIME_SECRET_ENCRYPTION_KEY;
  if (!raw) throw new Error("RUNTIME_SECRET_ENCRYPTION_KEY_NOT_CONFIGURED");

  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, "hex");
  else key = Buffer.from(raw, "base64");

  if (key.length !== 32) throw new Error("RUNTIME_SECRET_ENCRYPTION_KEY_INVALID");
  return key;
}

export function hasRuntimeSecretEncryptionKey() {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptSecret(value: string) {
  const plaintext = value.trim();
  if (!plaintext) throw new Error("EMPTY_SECRET");

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(packed: string) {
  const [version, ivRaw, tagRaw, ciphertextRaw] = packed.split(".");
  if (version !== VERSION || !ivRaw || !tagRaw || !ciphertextRaw) throw new Error("INVALID_ENCRYPTED_SECRET");

  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
