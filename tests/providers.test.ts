// @vitest-environment node
import { liveAccount } from "./fixtures";
import { offerings } from "@/lib/data";
import { matchOffering } from "@/lib/recommendations";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIOutreachGenerator, outreachWithFallback, providers } from "@/lib/providers";

const previous = { OPENAI_USE_MOCK: process.env.OPENAI_USE_MOCK, OPENAI_API_KEY: process.env.OPENAI_API_KEY, ZOOMINFO_PROVIDER: process.env.ZOOMINFO_PROVIDER };
afterEach(() => { vi.restoreAllMocks(); process.env.OPENAI_USE_MOCK = previous.OPENAI_USE_MOCK; process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY; process.env.ZOOMINFO_PROVIDER = previous.ZOOMINFO_PROVIDER; });

describe("provider selection", () => {
  it("defaults to mocks when credentials are absent", () => {
    delete process.env.OPENAI_API_KEY; process.env.OPENAI_USE_MOCK = "true"; process.env.ZOOMINFO_PROVIDER = "mock";
    const selected = providers(); expect(selected.useOpenAIMock).toBe(true); expect(selected.useZoomMock).toBe(true);
  });
});

it("falls back to grounded templates when AI generation fails", async () => {
  process.env.OPENAI_USE_MOCK = "false";
  process.env.OPENAI_API_KEY = "test-placeholder";
  vi.spyOn(OpenAIOutreachGenerator.prototype, "generate").mockRejectedValue(new Error("Model unavailable"));
  const account = liveAccount();
  const draft = await outreachWithFallback(account, matchOffering(account, offerings), "Direct");
  expect(draft.generationMethod).toBe("template");
  expect(draft.provenance).toBe("inferred");
  expect(draft.warnings[0]).toContain("AI generation was unavailable");
  expect(draft.body).toContain("growth investment");
});
