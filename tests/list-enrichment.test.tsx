import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListEnrichment } from "@/components/list-enrichment";
import { listAccountDetails } from "@/lib/repository";
import { accounts } from "@/lib/data";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const response = (payload: unknown, status = 200) => ({ ok: status === 200, status, json: async () => payload });
const details = () => listAccountDetails(accounts.slice(0, 6));

describe("manual list enrichment", () => {
  it("waits for a click, runs batches of five, and retries only accounts still pending after reload", async () => {
    let snapshot = details();
    let calls = 0;
    const fetchMock = vi.fn(async (_url: string, options?: { body?: string }) => {
      if (!options?.body) return response({ details: snapshot });
      const { accountIds } = JSON.parse(options.body!);
      calls++;
      snapshot = snapshot.map((item) => accountIds.includes(item.account.id) ? { ...item, account: { ...item.account, signal: { ...item.account.signal, source: { ...item.account.signal.source, provenance: calls === 1 && item.account.id === accountIds[0] ? "unknown" as const : "verified" as const } }, enrichment: calls === 1 && item.account.id === accountIds[0] ? { lastAttemptedAt: "2026-09-10", error: "Retry me", warnings: [] } : undefined } } : item);
      return response({ details: snapshot, refresh: { failed: calls === 1 ? [{ accountId: accountIds[0] }] : [] } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const onUpdate = vi.fn();
    const first = render(<ListEnrichment listId="health" ready details={snapshot} onUpdate={onUpdate} onBusy={vi.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Enrich pending accounts" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Finished: 6 of 6 processed · 1 failed"));
    const batches = fetchMock.mock.calls.filter((call) => call[1]?.body).map((call) => JSON.parse(call[1]!.body!));
    expect(batches.map((batch) => batch.accountIds.length)).toEqual([5, 1]);
    expect(batches.every((batch) => batch.listId === "health" && batch.force === false)).toBe(true);
    first.unmount();
    render(<ListEnrichment listId="health" ready details={snapshot} onUpdate={onUpdate} onBusy={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry failures" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Finished: 1 of 1"));
    expect(calls).toBe(3);
  });
  it("does not call ZoomInfo when disconnected or when refresh-all confirmation is cancelled", () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const props = { listId: "health", details: details(), onUpdate: vi.fn(), onBusy: vi.fn() };
    const view = render(<ListEnrichment {...props} ready={false} />);
    expect(screen.getByRole("button", { name: "Enrich pending accounts" })).toBeDisabled();
    view.rerender(<ListEnrichment {...props} ready />);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Refresh all" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("pauses between batches and keeps completed results available", async () => {
    let resolveBatch: (value: ReturnType<typeof response>) => void = () => {};
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ details: details() })).mockImplementationOnce(() => new Promise((resolve) => { resolveBatch = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ListEnrichment listId="health" ready details={details()} onUpdate={vi.fn()} onBusy={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enrich pending accounts" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    resolveBatch(response({ refresh: { failed: [] }, details: details() }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Paused: 5 of 6"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
