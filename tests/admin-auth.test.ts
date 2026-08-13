import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createAdminSessionToken, validRequestOrigin, verifyAdminPassword, verifyAdminSessionToken } from "@/lib/admin-auth";

const previous = { password: process.env.ADMIN_PASSWORD, secret: process.env.ADMIN_SESSION_SECRET };

describe("administrator authentication", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "correct horse battery staple";
    process.env.ADMIN_SESSION_SECRET = "test-session-secret-that-is-at-least-32-characters";
  });
  afterEach(() => { process.env.ADMIN_PASSWORD = previous.password; process.env.ADMIN_SESSION_SECRET = previous.secret; });

  it("signs an eight-hour session and rejects it after expiration", () => {
    const now = Date.parse("2026-08-13T12:00:00.000Z");
    const token = createAdminSessionToken(now);
    expect(verifyAdminSessionToken(token, now + 7 * 60 * 60 * 1000)).toBe(true);
    expect(verifyAdminSessionToken(token, now + 9 * 60 * 60 * 1000)).toBe(false);
    expect(verifyAdminSessionToken(`${token}x`, now)).toBe(false);
  });

  it("compares the configured password and enforces same-origin mutations", () => {
    expect(verifyAdminPassword("correct horse battery staple")).toBe(true);
    expect(verifyAdminPassword("incorrect")).toBe(false);
    expect(validRequestOrigin(new NextRequest("https://hack-team-09.vercel.app/api/admin/login", { method: "POST", headers: { origin: "https://hack-team-09.vercel.app" } }))).toBe(true);
    expect(validRequestOrigin(new NextRequest("http://localhost:4317/api/admin/login", { method: "POST", headers: { origin: "http://127.0.0.1:4317", host: "127.0.0.1:4317" } }))).toBe(true);
    expect(validRequestOrigin(new NextRequest("https://hack-team-09.vercel.app/api/admin/login", { method: "POST", headers: { origin: "https://example.com" } }))).toBe(false);
  });
});
