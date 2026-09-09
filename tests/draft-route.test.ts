import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/accounts/[id]/draft-outreach/route";
import { appPersistence, resetPersistenceForTests } from "@/lib/persistence";
import { resetSessionAccountsForTests } from "@/lib/session-store";
import { evidenceKey } from "@/lib/evidence";
import { liveAccount } from "./fixtures";

const previousMock = process.env.OPENAI_USE_MOCK;
beforeEach(() => { resetPersistenceForTests(); resetSessionAccountsForTests(); process.env.OPENAI_USE_MOCK = "true"; });
afterEach(() => { resetPersistenceForTests(); resetSessionAccountsForTests(); if (previousMock === undefined) delete process.env.OPENAI_USE_MOCK; else process.env.OPENAI_USE_MOCK = previousMock; });
const request = (body: object = {}) => new Request("http://localhost/api/accounts/draftkings/draft-outreach", { method: "POST", body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "draftkings" }) };

describe("outreach API grounding", () => {
  it("rejects seed-only accounts", async () => {
    expect((await POST(request(), context)).status).toBe(409);
  });
  it("uses persisted ZoomInfo evidence with templates when OpenAI is disabled", async () => {
    const account = liveAccount();
    await appPersistence().saveAccounts([account]);
    const response = await POST(request({ tone: "Executive", evidenceKey: evidenceKey(account) }), context);
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.draft.generationMethod).toBe("template");
    expect(payload.draft.body).toContain("growth investment");
    expect(payload.draft.provenance).toBe("inferred");
    expect(payload.fallback).toBe(false);
  });
  it("rejects generation against outdated client evidence", async () => {
    await appPersistence().saveAccounts([liveAccount()]);
    expect((await POST(request({ evidenceKey: "outdated" }), context)).status).toBe(409);
  });
  it("uses a selected verified buyer and retains the original evidence revision", async () => {
    const account = liveAccount();
    account.buyers.push({ ...account.buyers[0], id: "zoominfo-person-456", name: "Taylor Example", title: "Chief Financial Officer" });
    await appPersistence().saveAccounts([account]);
    const response = await POST(request({ buyerId: "zoominfo-person-456" }), context);
    const { draft } = await response.json();
    expect(draft.body).toContain("Hello Taylor Example");
    expect(draft.body).toContain("Chief Financial Officer");
    expect(draft.recipientId).toBe("zoominfo-person-456");
    expect(draft.evidenceKey).toBe(evidenceKey(account));
    expect((await POST(request({ buyerId: "invented" }), context)).status).toBe(400);
  });

});
