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
    // Tamper with the first ciphertext character rather than the last: the trailing
    // base64url character carries padding bits, so for roughly one random IV in
    // seventeen the edit decoded to identical bytes and the tamper went undetected.
    const [version, iv, tag, ciphertext] = encrypted.split(".");
    const tampered = [version, iv, tag, `${ciphertext.startsWith("A") ? "B" : "A"}${ciphertext.slice(1)}`].join(".");
    expect(() => decryptOAuthTokens(tampered)).toThrow();
    process.env.ZOOMINFO_TOKEN_ENCRYPTION_KEY = "not-a-32-byte-key";
    expect(tokenEncryptionConfigured()).toBe(false);
  });
});
