import { liveAccount } from "./fixtures";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Dashboard } from "@/components/dashboard";
import { listAccountDetails } from "@/lib/repository";
import type { IntegrationStatus } from "@/lib/schemas";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

const status: IntegrationStatus = {
  demoMode: true,
  diagnostics: [
    { provider: "OpenAI", mode: "mock", status: "ready", configured: false, message: "Deterministic mock active.", checkedAt: "2026-08-13T12:00:00.000Z" },
    { provider: "ZoomInfo", mode: "mock", status: "ready", configured: false, message: "Seeded signals active.", checkedAt: "2026-08-13T12:00:00.000Z" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("workspace navigation", () => {
  beforeAll(() => {
    Object.defineProperty(window, "scrollTo", { value: vi.fn(), writable: true });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });
  });

  it("restores the selected account and stage supplied by the URL boundary", () => {
    const details = listAccountDetails();
    render(<Dashboard initialDetails={details} initialStatus={status} metrics={{ rows: 20, canonicalAccounts: 19, pursueNow: 2 }} initialAccountId="marriott-vacations-corp" initialStage="pursuit" />);

    expect(screen.getByRole("heading", { name: "Marriott Vacations Worldwide Corporation" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Pursuit/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Likely buying committee" })).toBeInTheDocument();
  });

  it("supports arrow-key navigation across the workflow tabs", () => {
    const details = listAccountDetails();
    render(<Dashboard initialDetails={details} initialStatus={status} metrics={{ rows: 20, canonicalAccounts: 19, pursueNow: 2 }} initialStage="prioritize" />);

    const prioritize = screen.getByRole("tab", { name: /Prioritize/ });
    prioritize.focus();
    fireEvent.keyDown(prioritize, { key: "ArrowRight" });

    const pursuit = screen.getByRole("tab", { name: /Pursuit/ });
    expect(pursuit).toHaveAttribute("aria-selected", "true");
    expect(pursuit).toHaveFocus();
  });

  it("shows a connection action and disables refresh when MCP is disconnected", () => {
    const details = listAccountDetails();
    const disconnectedStatus: IntegrationStatus = {
      ...status,
      demoMode: false,
      zoomInfo: {
        state: "disconnected",
        requiredToolsReady: false,
        liveAccounts: 0,
        totalCanonicalAccounts: 19,
      },
    };
    render(<Dashboard initialDetails={details} initialStatus={disconnectedStatus} metrics={{ rows: 20, canonicalAccounts: 19, pursueNow: 2 }} initialStage="prioritize" />);

    expect(screen.getByRole("button", { name: "Connect ZoomInfo to refresh" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open ZoomInfo setup" }));
    expect(screen.getByRole("button", { name: "Connect ZoomInfo" })).toBeEnabled();
  });

  it("shows persisted buyer research counts in Prioritize and the exact empty result in Pursuit", () => {
    const account = liveAccount();
    account.buyers = [];
    account.enrichment = {
      lastAttemptedAt: "2026-09-10T12:00:00Z",
      lastSuccessfulAt: "2026-09-10T12:00:00Z",
      warnings: [],
      buyerResearch: { status: "empty", recommendationsReturned: 0, usableContactIds: 0, contactsHydrated: 0, contactsRejected: 0, message: "ZoomInfo returned no recommended contacts for this account." },
    };
    render(<Dashboard initialDetails={listAccountDetails([account])} initialStatus={status} metrics={{ rows: 1, canonicalAccounts: 1, pursueNow: 0 }} initialStage="prioritize" />);
    expect(screen.getByText("Buyer research:")).toBeInTheDocument();
    expect(screen.getByText(/Recommendations 0 · usable IDs 0 · contacts hydrated 0 · rejected 0/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /Pursuit/ }));
    expect(screen.getByText("ZoomInfo returned no recommended contacts for this account.")).toBeInTheDocument();
    expect(screen.queryByText("No verified buyer is available. Refresh contacts or complete buyer research before choosing a recipient.")).not.toBeInTheDocument();
  });

  it("offers accessible contact actions and copies buyer details", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const account = liveAccount();
    account.buyers[0] = { ...account.buyers[0], email: "jordan@example.com", phone: "+1 555-0100", linkedinUrl: "https://www.linkedin.com/in/jordan-example" };
    render(<Dashboard initialDetails={listAccountDetails([account])} initialStatus={status} metrics={{ rows: 1, canonicalAccounts: 1, pursueNow: 1 }} initialStage="pursuit" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy email for Jordan Example" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("jordan@example.com"));
    expect(screen.getByRole("status")).toHaveTextContent("Email copied.");
    fireEvent.click(screen.getByRole("button", { name: "Copy phone for Jordan Example" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("+1 555-0100"));
    const linkedinLink = screen.getByRole("link", { name: "Open LinkedIn profile for Jordan Example" });
    expect(linkedinLink).toHaveAttribute("href", "https://www.linkedin.com/in/jordan-example");
    expect(linkedinLink.querySelector("svg[data-testid='linkedin-logo']")).toBeInTheDocument();
  });

  it("does not render a LinkedIn action for a saved non-profile URL", () => {
    const account = liveAccount();
    account.buyers[0] = { ...account.buyers[0], linkedinUrl: "https://www.linkedin.com/feed/" };
    render(<Dashboard initialDetails={listAccountDetails([account])} initialStatus={status} metrics={{ rows: 1, canonicalAccounts: 1, pursueNow: 1 }} initialStage="pursuit" />);
    expect(screen.queryByRole("link", { name: "Open LinkedIn profile for Jordan Example" })).not.toBeInTheDocument();
  });
});


describe("live outreach workflow", () => {
  it("generates on entry and preserves edited drafts when refreshed evidence changes", async () => {
    const account = liveAccount();
    const details = listAccountDetails([account]);
    const refreshed = structuredClone(account);
    refreshed.signal.summary = "Updated investment announcement";
    refreshed.signal.source.observedAt = "2026-09-08T13:00:00Z";
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ draft: details[0].outreach }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ details: listAccountDetails([refreshed]), refresh: { updated: 1, cached: 0, failed: [], estimatedCompanyCredits: 2 } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialDetails={details} initialStatus={status} metrics={{ rows: 1, canonicalAccounts: 1, pursueNow: 0 }} initialStage="pursuit" />);
    fireEvent.click(screen.getByRole("button", { name: /Draft outreach/ }));
    await waitFor(() => expect(screen.getByLabelText("Editable outreach email")).toBeEnabled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/accounts/draftkings/draft-outreach");
    fireEvent.change(screen.getByLabelText("Editable outreach email"), { target: { value: "My carefully edited email" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh signals" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Prioritize/ })).toHaveAttribute("aria-selected", "true"));
    fireEvent.click(screen.getByRole("tab", { name: /Outreach/ }));
    expect(screen.getByLabelText("Editable outreach email")).toHaveValue("My carefully edited email");
    expect(screen.getByText(/Your draft has been preserved/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy draft" })).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows pending research and targets the selected account for refresh", async () => {
    const details = listAccountDetails();
    const liveStatus: IntegrationStatus = { ...status, demoMode: false, diagnostics: [{ provider: "ZoomInfo", mode: "live", status: "ready", configured: true, message: "Ready", checkedAt: "2026-09-08" }], zoomInfo: { state: "ready", requiredToolsReady: true, liveAccounts: 0, totalCanonicalAccounts: 19 } };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ details }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialDetails={details} initialStatus={liveStatus} metrics={{ rows: 20, canonicalAccounts: 19, pursueNow: 0 }} initialAccountId="meta" initialStage="prioritize" />);
    expect(screen.queryByText("Demo transformation signal requiring confirmation from a licensed signal provider.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh this account" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ accountId: "meta" });
  });

  it("does not generate outreach for an account without an observed trigger", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialDetails={listAccountDetails()} initialStatus={status} metrics={{ rows: 20, canonicalAccounts: 19, pursueNow: 0 }} initialStage="outreach" />);
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
