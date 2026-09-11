import { liveAccount } from "../tests/fixtures";
import { listAccountDetails } from "../lib/repository";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("laptop journey carries ZoomInfo evidence through all three stages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const details = listAccountDetails([liveAccount()]);
  const status = { demoMode: false, diagnostics: [{ provider: "ZoomInfo", mode: "live", status: "ready", configured: true, message: "Fixture connection", checkedAt: "2026-09-08" }, { provider: "OpenAI", mode: "mock", status: "ready", configured: false, message: "Templates", checkedAt: "2026-09-08" }], zoomInfo: { state: "ready", requiredToolsReady: true, liveAccounts: 1, totalCanonicalAccounts: 1 } };
  await page.route("**/api/integrations/status", (route) => route.fulfill({ json: status }));
  await page.route("**/api/target-lists/starter/accounts", (route) => route.fulfill({ json: { details: listAccountDetails().filter((item) => item.account.id === "draftkings") } }));
  await page.route("**/api/signals/refresh", (route) => route.fulfill({ json: { details, status, featuredAccountId: "draftkings", metrics: { rows: 1, canonicalAccounts: 1, pursueNow: 0 }, refresh: { updated: 1, cached: 0, failed: [], estimatedCompanyCredits: 0 } } }));
  await page.route("**/api/accounts/draftkings/draft-outreach", (route) => route.fulfill({ json: { draft: details[0].outreach, fallback: false } }));
  await page.goto("/lists/starter");

  await expect(page.getByRole("heading", { name: "Who to call today" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Prioritize/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Open ZoomInfo setup" }).click();
  await page.getByRole("button", { name: "Close diagnostics" }).click();
  await page.getByRole("button", { name: "Enrich pending accounts" }).click();
  await expect(page.getByRole("status")).toContainText("Finished:");
  await page.getByRole("button", { name: /Map buyer and offering/ }).click();
  await expect(page.getByRole("tab", { name: /Pursuit/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Copy email for Jordan Example" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy phone for Jordan Example" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open LinkedIn profile for Jordan Example" })).toHaveAttribute("href", "https://www.linkedin.com/in/jordan-example");
  await page.getByRole("button", { name: /Draft outreach/ }).click();
  await expect(page.getByRole("tab", { name: /Outreach/ })).toHaveAttribute("aria-selected", "true");

  await expect(page.getByLabel("Editable outreach email")).toBeEnabled();
  await expect(page.getByLabel("Editable outreach email")).toHaveValue(/Announced a new growth investment/);
  await expect(page.locator("main")).not.toContainText("Demo data");
  expect(errors).toEqual([]);
  const draft = await page.getByLabel("Editable outreach email").inputValue();
  const wordCount = draft.trim().split(/\s+/).filter(Boolean).length;
  expect(wordCount).toBeGreaterThanOrEqual(100);
  expect(wordCount).toBeLessThanOrEqual(160);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("laptop-outreach.png"), fullPage: true });
});

test("buyer map explains an empty ZoomInfo recommendation result", async ({ page }) => {
  const account = liveAccount();
  account.buyers = [];
  account.enrichment = {
    lastAttemptedAt: "2026-09-10T12:00:00Z",
    lastSuccessfulAt: "2026-09-10T12:00:00Z",
    warnings: [],
    buyerResearch: { status: "empty", recommendationsReturned: 0, usableContactIds: 0, contactsHydrated: 0, contactsRejected: 0, message: "ZoomInfo returned no recommended contacts for this account." },
  };
  const details = listAccountDetails([account]);
  const status = { demoMode: false, diagnostics: [{ provider: "ZoomInfo", mode: "live", status: "ready", configured: true, message: "Fixture connection", checkedAt: "2026-09-10" }], zoomInfo: { state: "ready", requiredToolsReady: true, liveAccounts: 1, totalCanonicalAccounts: 1 } };
  await page.route("**/api/integrations/status", (route) => route.fulfill({ json: status }));
  await page.route("**/api/signals/refresh", (route) => route.fulfill({ json: { details, status, featuredAccountId: account.id, metrics: { rows: 1, canonicalAccounts: 1, pursueNow: 0 }, refresh: { updated: 1, cached: 0, failed: [], estimatedCompanyCredits: 0 } } }));
  await page.goto(`/lists/starter?account=${account.id}`);
  await page.getByRole("button", { name: "Refresh this account" }).click();
  await expect(page.getByText(/Recommendations 0 · usable IDs 0 · contacts hydrated 0 · rejected 0/)).toBeVisible();
  await page.getByRole("button", { name: /Map buyer and offering/ }).click();
  await expect(page.getByText("ZoomInfo returned no recommended contacts for this account.")).toBeVisible();
  await expect(page.getByText(/No verified buyer is available/)).toHaveCount(0);
});

test("narrow layout moves from queue to focused detail without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lists/starter");

  await expect(page.getByRole("heading", { name: "Who to call today" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.locator(".account-row").first().click();
  await expect(page.getByRole("button", { name: "Back to queue" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Prioritize/ })).toHaveAttribute("aria-selected", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("narrow-detail.png"), fullPage: true });
});
