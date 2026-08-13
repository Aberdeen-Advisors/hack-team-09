import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { StoredOAuthTokens } from "@modelcontextprotocol/client";

const VERSION = "v1";

function encryptionKey(): Buffer {
  const configured = process.env.ZOOMINFO_TOKEN_ENCRYPTION_KEY;
  if (!configured) throw new Error("ZOOMINFO_TOKEN_ENCRYPTION_KEY is not configured");
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32) throw new Error("ZOOMINFO_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return key;
}

export function tokenEncryptionConfigured(): boolean {
  try { encryptionKey(); return true; } catch { return false; }
}

export function encryptOAuthTokens(tokens: StoredOAuthTokens): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptOAuthTokens(blob: string): StoredOAuthTokens {
  const [version, ivValue, tagValue, ciphertextValue] = blob.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !ciphertextValue) throw new Error("Stored ZoomInfo token data is malformed");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(plaintext) as StoredOAuthTokens;
}
