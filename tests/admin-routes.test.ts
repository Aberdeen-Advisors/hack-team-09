import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/admin/login/route";
import { POST as connectZoomInfo } from "@/app/api/integrations/zoominfo/connect/route";
import { POST as refreshSignals } from "@/app/api/signals/refresh/route";
import { resetPersistenceForTests } from "@/lib/persistence";

const previous = { password: process.env.ADMIN_PASSWORD, secret: process.env.ADMIN_SESSION_SECRET };
const url = "https://hack-team-09.vercel.app";

function request(path: string, body?: unknown) {
  return new NextRequest(`${url}${path}`, {
    method: "POST",
    headers: { origin: url, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("administrator route protection", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "correct-password";
    process.env.ADMIN_SESSION_SECRET = "route-test-session-secret-with-at-least-32-characters";
    resetPersistenceForTests();
  });
  afterEach(() => {
    if (previous.password === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.ADMIN_SESSION_SECRET; else process.env.ADMIN_SESSION_SECRET = previous.secret;
  });

  it("issues an HTTP-only session cookie after a valid password", async () => {
    const response = await login(request("/api/admin/login", { password: "correct-password" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("signal_outreach_admin=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=lax");
  });

  it("rate limits repeated invalid passwords", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await login(request("/api/admin/login", { password: "wrong" }))).status).toBe(401);
    expect((await login(request("/api/admin/login", { password: "correct-password" }))).status).toBe(429);
  });

  it("rejects viewer requests before starting ZoomInfo or spending refresh credits", async () => {
    expect((await connectZoomInfo(request("/api/integrations/zoominfo/connect"))).status).toBe(401);
    expect((await refreshSignals(request("/api/signals/refresh"))).status).toBe(401);
  });
});
