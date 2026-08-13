import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Dashboard } from "@/components/dashboard";
import { listAccountDetails } from "@/lib/repository";
import type { IntegrationStatus } from "@/lib/schemas";

vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt ?? ""} />,
}));

const status: IntegrationStatus = {
  demoMode: true,
  admin: { authenticated: true, configured: true },
  diagnostics: [
    { provider: "OpenAI", mode: "mock", status: "ready", configured: false, message: "Deterministic mock active.", checkedAt: "2026-08-13T12:00:00.000Z" },
    { provider: "ZoomInfo", mode: "mock", status: "ready", configured: false, message: "Seeded signals active.", checkedAt: "2026-08-13T12:00:00.000Z" },
  ],
};

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

  it("keeps ZoomInfo mutations read-only until an administrator signs in", () => {
    const details = listAccountDetails();
    render(<Dashboard initialDetails={details} initialStatus={{ ...status, admin: { authenticated: false, configured: true } }} metrics={{ rows: 20, canonicalAccounts: 19, pursueNow: 2 }} initialStage="prioritize" />);
    expect(screen.getByRole("button", { name: "Admin sign in to refresh" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Open ZoomInfo setup" }));
    expect(screen.getByLabelText("Administrator password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Administrator password")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Unlock connection controls" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Administrator password"), { target: { value: "test-password" } });
    expect(screen.getByRole("button", { name: "Unlock connection controls" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Connect ZoomInfo" })).not.toBeInTheDocument();
  });
});
