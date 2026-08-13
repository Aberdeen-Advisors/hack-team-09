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
});
