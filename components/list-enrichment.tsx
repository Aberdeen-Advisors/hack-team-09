"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountDetail, IntegrationStatus } from "@/lib/schemas";

export type WorkspaceUpdate = { details?: AccountDetail[]; metrics?: { rows: number; canonicalAccounts: number; pursueNow: number }; status?: IntegrationStatus };
export function ListEnrichment({ listId, ready, details, onUpdate, onBusy }: { listId: string; ready: boolean; details: AccountDetail[]; onUpdate: (value: WorkspaceUpdate) => void; onBusy: (busy: boolean) => void }) {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopped = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { stopped.current = true; mounted.current = false; }; }, []);
  const failed = details.filter((item) => item.account.enrichment?.error);
  async function enrich(force = false) {
    if (!ready || running) return;
    if (force && !window.confirm("Refresh all companies in this list? This queries ZoomInfo again and may use credits.")) return;
    stopped.current = false; setRunning(true); onBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/target-lists/${listId}/accounts`, { cache: "no-store" });
      const fresh = await response.json();
      if (!response.ok) throw new Error(fresh.error || "Unable to load list");
      if (!mounted.current) return;
      onUpdate(fresh);
      const accounts: AccountDetail[] = fresh.details;
      const candidates = [...new Map(accounts.filter(({ account }) => force || account.signal.source.provenance !== "verified" || account.enrichment?.error).map(({ account }) => [account.canonicalCompanyId, account.id])).values()];
      setProgress({ done: 0, total: candidates.length });
      let failedCount = 0;
      let completed = 0;
      for (let offset = 0; offset < candidates.length && !stopped.current; offset += 5) {
        const batch = candidates.slice(offset, offset + 5);
        const result = await fetch("/api/signals/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ listId, accountIds: batch, force }) });
        const payload = await result.json();
        if (!mounted.current) return;
        onUpdate(payload);
        if (!result.ok && result.status !== 502) throw new Error(payload.error || "Enrichment stopped");
        failedCount += result.ok ? payload.refresh?.failed?.length || 0 : batch.length;
        completed += batch.length;
        setProgress({ done: completed, total: candidates.length });
        setMessage(`${completed} of ${candidates.length} accounts processed · ${failedCount} failed. Results are saved.`);
      }
      if (!candidates.length) setMessage("All accounts already have verified enrichment. Use Refresh all to check again.");
      else setMessage(`${stopped.current ? "Paused" : "Finished"}: ${completed} of ${candidates.length} processed · ${failedCount} failed. ${stopped.current ? "Click Enrich pending accounts to resume." : failedCount ? "Review failures below and retry." : "Results saved."}`);
    } catch (error) { if (mounted.current) setMessage(`${error instanceof Error ? error.message : "Enrichment stopped"}. Completed batches are saved; you can retry.`); }
    finally { if (mounted.current) { setRunning(false); onBusy(false); } }
  }
  return <section className="list-enrichment" aria-label="List enrichment">
    <button className="refresh-button" disabled={!ready || running} onClick={() => void enrich()}>{running ? "Enriching accounts…" : "Enrich pending accounts"}</button>
    <div className="enrichment-actions"><button className="secondary-button" disabled={!ready || running} onClick={() => void enrich(true)}>Refresh all</button>{failed.length > 0 && <button className="secondary-button" disabled={!ready || running} onClick={() => void enrich()}>Retry failures</button>}{running && <button className="secondary-button" onClick={() => { stopped.current = true; setMessage("Pausing after the current batch finishes…"); }}>Pause</button>}</div>
    {!ready && <p className="refresh-note">Connect live ZoomInfo to enrich this list.</p>}
    {progress.total > 0 && <progress aria-label="Enrichment progress" max={progress.total} value={progress.done} />}
    {message && <p role="status" className="refresh-note">{message}</p>}
    {!!failed.length && <details className="enrichment-failures"><summary>{failed.length} account failures</summary><ul>{failed.map(({ account }) => <li key={account.id}><strong>{account.name}:</strong> {account.enrichment?.error}</li>)}</ul></details>}
  </section>;
}
