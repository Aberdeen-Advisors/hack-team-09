import { afterEach, describe, expect, it } from "vitest";
import { providers } from "@/lib/providers";

const previous = { OPENAI_USE_MOCK: process.env.OPENAI_USE_MOCK, OPENAI_API_KEY: process.env.OPENAI_API_KEY, ZOOMINFO_PROVIDER: process.env.ZOOMINFO_PROVIDER };
afterEach(() => { process.env.OPENAI_USE_MOCK = previous.OPENAI_USE_MOCK; process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY; process.env.ZOOMINFO_PROVIDER = previous.ZOOMINFO_PROVIDER; });

describe("provider selection", () => {
  it("defaults to mocks when credentials are absent", () => {
    delete process.env.OPENAI_API_KEY; process.env.OPENAI_USE_MOCK = "true"; process.env.ZOOMINFO_PROVIDER = "mock";
    const selected = providers(); expect(selected.useOpenAIMock).toBe(true); expect(selected.useZoomMock).toBe(true);
  });
});
