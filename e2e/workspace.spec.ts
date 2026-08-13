import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("laptop demo journey reaches outreach in two guided advances", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Who to call today" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Prioritize/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Open integration diagnostics" }).click();
  await page.getByLabel("Administrator password").fill("e2e-admin-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close diagnostics" }).click();
  await page.getByRole("button", { name: "Refresh signals" }).click();
  await expect(page.getByRole("status")).toContainText("accounts refreshed");
  await page.getByRole("button", { name: /Map buyer and offering/ }).click();
  await expect(page.getByRole("tab", { name: /Pursuit/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: /Draft outreach/ }).click();
  await expect(page.getByRole("tab", { name: /Outreach/ })).toHaveAttribute("aria-selected", "true");

  const draft = await page.getByLabel("Editable outreach email").inputValue();
  const wordCount = draft.trim().split(/\s+/).filter(Boolean).length;
  expect(wordCount).toBeGreaterThanOrEqual(100);
  expect(wordCount).toBeLessThanOrEqual(160);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((item) => ["critical", "serious"].includes(item.impact ?? ""))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("laptop-outreach.png"), fullPage: true });
});

test("narrow layout moves from queue to focused detail without overflow", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

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
