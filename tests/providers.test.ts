import { afterEach, describe, expect, it } from "vitest";
import { providers } from "@/lib/providers";

const previous = { OPENAI_USE_MOCK: process.env.OPENAI_USE_MOCK, OPENAI_API_KEY: process.env.OPENAI_API_KEY, ZOOMINFO_USE_MOCK: process.env.ZOOMINFO_USE_MOCK };
afterEach(() => { process.env.OPENAI_USE_MOCK = previous.OPENAI_USE_MOCK; process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY; process.env.ZOOMINFO_USE_MOCK = previous.ZOOMINFO_USE_MOCK; });

describe("provider selection", () => {
  it("defaults to mocks when credentials are absent", () => {
    delete process.env.OPENAI_API_KEY; delete process.env.ZOOMINFO_CLIENT_ID; process.env.OPENAI_USE_MOCK = "true"; process.env.ZOOMINFO_USE_MOCK = "true";
    const selected = providers(); expect(selected.useOpenAIMock).toBe(true); expect(selected.useZoomMock).toBe(true);
  });
});
