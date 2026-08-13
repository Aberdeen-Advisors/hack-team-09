import { beforeEach, describe, expect, it } from "vitest";
import { appPersistence, resetPersistenceClientForTests, resetPersistenceForTests } from "@/lib/persistence";

describe("shared persistence contract", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL; delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL; delete process.env.KV_REST_API_TOKEN;
    resetPersistenceForTests();
  });

  it("consumes OAuth state once across separate persistence clients", async () => {
    await appPersistence().createPendingOAuth({ state: "state-1", createdAt: new Date().toISOString(), codeVerifier: "verifier" }, 600);
    resetPersistenceClientForTests();
    expect(await appPersistence().consumePendingOAuth("state-1")).toMatchObject({ state: "state-1", codeVerifier: "verifier" });
    expect(await appPersistence().consumePendingOAuth("state-1")).toBeNull();
  });

  it("prevents concurrent refresh locks and releases only for the owner", async () => {
    const persistence = appPersistence();
    expect(await persistence.acquireLock("refresh", "owner-a", 60)).toBe(true);
    expect(await persistence.acquireLock("refresh", "owner-b", 60)).toBe(false);
    await persistence.releaseLock("refresh", "owner-b");
    expect(await persistence.acquireLock("refresh", "owner-b", 60)).toBe(false);
    await persistence.releaseLock("refresh", "owner-a");
    expect(await persistence.acquireLock("refresh", "owner-b", 60)).toBe(true);
  });

  it("tracks and clears login failures", async () => {
    const persistence = appPersistence();
    expect(await persistence.recordLoginFailure("client", 900)).toBe(1);
    expect(await persistence.recordLoginFailure("client", 900)).toBe(2);
    expect(await persistence.getLoginFailures("client")).toBe(2);
    await persistence.clearLoginFailures("client");
    expect(await persistence.getLoginFailures("client")).toBe(0);
  });
});
