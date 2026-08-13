import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptOAuthTokens, encryptOAuthTokens, tokenEncryptionConfigured } from "@/lib/token-crypto";

const previous = process.env.ZOOMINFO_TOKEN_ENCRYPTION_KEY;

describe("ZoomInfo token encryption", () => {
  beforeEach(() => { process.env.ZOOMINFO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64"); });
  afterEach(() => { process.env.ZOOMINFO_TOKEN_ENCRYPTION_KEY = previous; });

  it("round-trips OAuth tokens without storing plaintext", () => {
    const tokens = { access_token: "access-secret", refresh_token: "refresh-secret", token_type: "Bearer", expires_in: 3600 };
    const encrypted = encryptOAuthTokens(tokens);
    expect(encrypted).not.toContain("access-secret");
    expect(decryptOAuthTokens(encrypted)).toEqual(tokens);
  });

  it("rejects tampered ciphertext and invalid keys", () => {
    const encrypted = encryptOAuthTokens({ access_token: "secret", token_type: "Bearer" });
    const replacement = encrypted.endsWith("A") ? "B" : "A";
    expect(() => decryptOAuthTokens(`${encrypted.slice(0, -1)}${replacement}`)).toThrow();
    process.env.ZOOMINFO_TOKEN_ENCRYPTION_KEY = "not-a-32-byte-key";
    expect(tokenEncryptionConfigured()).toBe(false);
  });
});
