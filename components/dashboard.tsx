"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Clipboard, ExternalLink, LoaderCircle, RefreshCw, Settings2, Signal as SignalIcon, Sparkles, Users, X } from "lucide-react";
import { evidenceKey, hasCurrentSignal, verifiedWarmBuyer } from "@/lib/evidence";
import type { Account, AccountDetail, IntegrationStatus, OutreachDraft, WorkspaceStage } from "@/lib/schemas";

type DashboardProps = { initialDetails: AccountDetail[]; initialStatus: IntegrationStatus; metrics: { rows: number; canonicalAccounts: number; pursueNow: number }; initialAccountId?: string; initialStage: WorkspaceStage };
const stages: { id: WorkspaceStage; label: string }[] = [{ id: "prioritize", label: "Prioritize" }, { id: "pursuit", label: "Pursuit" }, { id: "outreach", label: "Outreach" }];
const provenanceBadge = (value: string) => <span className={`badge ${value === "demo" ? "demo" : ""}`}>{value === "demo" ? "Demo data" : value}</span>;
const warmthClass = (warmth: string) => warmth === "Warm" ? "warm" : warmth === "Indirect" ? "indirect" : "";

export function Dashboard({ initialDetails, initialStatus, metrics, initialAccountId, initialStage }: DashboardProps) {
  const [details, setDetails] = useState(initialDetails);
  const [workspaceMetrics, setWorkspaceMetrics] = useState(metrics);
  const [selectedId, setSelectedId] = useState(initialAccountId ?? initialDetails[0]?.account.id ?? "");
  const [stage, setStage] = useState<WorkspaceStage>(initialStage);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [sort, setSort] = useState("score");
  const [industry, setIndustry] = useState("all");
  const [signalType, setSignalType] = useState("all");
  const [warmOnly, setWarmOnly] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState(initialStatus);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [tone, setTone] = useState<OutreachDraft["tone"]>("Direct");
  const [recipientIds, setRecipientIds] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, OutreachDraft>>({});
  const [draftBodies, setDraftBodies] = useState<Record<string, string>>({});
  const [generatingIds, setGeneratingIds] = useState<string[]>([]);
  const requestedDrafts = useRef(new Set<string>());
  const editedAccounts = useRef(new Set<string>());
  const [connecting, setConnecting] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = details.find((item) => item.account.id === selectedId) ?? details[0];
  const activeDraft = selected ? drafts[selected.account.id] ?? selected.outreach : undefined;
  const generating = selected ? generatingIds.includes(selected.account.id) : false;
  const recipientId = selected ? recipientIds[selected.account.id] ?? selected.account.buyers.find((buyer) => buyer.source.provenance === "verified")?.id : undefined;
  const staleDraft = Boolean(selected && drafts[selected.account.id] && (drafts[selected.account.id].evidenceKey !== evidenceKey(selected.account) || (drafts[selected.account.id].recipientId ?? undefined) !== recipientId));
  const draftBody = selected ? draftBodies[selected.account.id] ?? activeDraft?.body ?? "" : "";
  useEffect(() => {
    if (!selected) return;
    const url = new URL(window.location.href);
    url.searchParams.set("account", selected.account.id); url.searchParams.set("stage", stage);
    window.history.replaceState(null, "", url);
  }, [selected, stage]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const zoomInfo = params.get("zoominfo");
    const message = zoomInfo === "connected" ? "ZoomInfo connected. Refresh signals to load live data." : zoomInfo === "error" ? params.get("message") || "ZoomInfo connection failed." : "";
    if (!message) return;
    const timer = window.setTimeout(() => setToast(message), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const industries = useMemo(() => Array.from(new Set(details.map((item) => item.account.industry))).sort(), [details]);
  const signalTypes = useMemo(() => Array.from(new Set(details.map((item) => item.account.signal.type))).sort(), [details]);
  const filtered = useMemo(() => {
    const list = details.filter((item) => (industry === "all" || item.account.industry === industry) && (signalType === "all" || item.account.signal.type === signalType) && (!warmOnly || Boolean(verifiedWarmBuyer(item.account.buyers))));
    return [...list].sort((a, b) => sort === "company" ? a.account.name.localeCompare(b.account.name) : b.score.total - a.score.total);
  }, [details, industry, signalType, warmOnly, sort]);

  function selectAccount(id: string) { setSelectedId(id); setStage("prioritize"); setMobileDetail(true); setTone(drafts[id]?.tone ?? "Direct"); }

  async function refreshSignals(accountId?: string) {
    setRefreshing(true);
    try {
      const response = await fetch("/api/signals/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) });
      const payload = await response.json();
      if (payload.details) setDetails(payload.details);
      if (payload.status) setStatus(payload.status);
      if (payload.metrics) setWorkspaceMetrics(payload.metrics);
      if (!response.ok) throw new Error(payload.error || "Refresh failed");
      setSelectedId(accountId || selectedId || payload.featuredAccountId); setStage("prioritize");
      const refresh = payload.refresh;
      setToast(refresh ? `${refresh.updated} accounts refreshed (${refresh.cached} cached, ${refresh.failed.length} failed). ${refresh.estimatedCompanyCredits === null ? "Credit usage: check ZoomInfo usage." : `Estimated credits: ${refresh.estimatedCompanyCredits}.`}${refresh.failed.length ? ` Failed: ${refresh.failed.map((item: { accountName: string }) => item.accountName).join(", ")}.` : ""}` : `${payload.signalCount} canonical signals refreshed.`);
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to refresh signals"); }
    finally { setRefreshing(false); }
  }

  async function refreshStatus() {
    const response = await fetch("/api/integrations/status", { cache: "no-store" });
    if (response.ok) setStatus(await response.json());
  }

  async function connectZoomInfo() {
    setConnecting(true);
    try {
      const response = await fetch("/api/integrations/zoominfo/connect", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to connect ZoomInfo");
      window.location.assign(payload.authorizationUrl);
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to connect ZoomInfo"); setConnecting(false); }
  }

  async function disconnectZoomInfo() {
    try {
      const response = await fetch("/api/integrations/zoominfo/disconnect", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to disconnect ZoomInfo");
      await refreshStatus();
      setToast("ZoomInfo disconnected. Previously refreshed account data remains visible.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to disconnect ZoomInfo"); }
  }

  const generateDraft = useCallback(async (account: Account, requestedTone: OutreachDraft["tone"], explicit = false, buyerId?: string) => {
    if (!hasCurrentSignal(account)) return;
    setGeneratingIds((current) => [...current, account.id]);
    try {
      const response = await fetch(`/api/accounts/${account.id}/draft-outreach`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tone: requestedTone, evidenceKey: evidenceKey(account), buyerId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Draft generation failed");
      // A slow response must not overwrite text edited while the request was running.
      if (!explicit && editedAccounts.current.has(account.id)) return;
      setDrafts((current) => ({ ...current, [account.id]: payload.draft }));
      setDraftBodies((current) => ({ ...current, [account.id]: payload.draft.body }));
      editedAccounts.current.delete(account.id);
      setToast(payload.fallback ? "AI unavailable; draft generated from the evidence-based template." : "Draft generated for review.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Unable to generate draft"); }
    finally { setGeneratingIds((current) => current.filter((id) => id !== account.id)); }
  }, []);

  useEffect(() => {
    if (stage !== "outreach" || !selected || !hasCurrentSignal(selected.account) || drafts[selected.account.id] || editedAccounts.current.has(selected.account.id)) return;
    const key = evidenceKey(selected.account);
    if (requestedDrafts.current.has(key)) return;
    requestedDrafts.current.add(key);
    void generateDraft(selected.account, "Direct", false, recipientId);
  }, [stage, selected, drafts, generateDraft, recipientId]);

  async function regenerate() {
    if (selected) await generateDraft(selected.account, tone, true, recipientId);
  }
  async function copyDraft() { await navigator.clipboard.writeText(draftBody); setToast("Draft copied. Review evidence and recipient details before sending."); }
  function advance() { setStage(stage === "prioritize" ? "pursuit" : "outreach"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = (index + (event.key === "ArrowRight" ? 1 : -1) + stages.length) % stages.length; setStage(stages[next].id); tabRefs.current[next]?.focus(); }

  if (!selected) return <main className="empty-state">No accounts are available.</main>;
  const warm = verifiedWarmBuyer(selected.account.buyers);
  const liveMode = status.zoomInfo?.state !== "mock" && status.diagnostics.some((item) => item.provider === "ZoomInfo" && item.mode === "live");
  const pendingResearch = liveMode && selected.account.signal.source.provenance !== "verified";
  const visibleBuyers = selected.account.buyers.filter((buyer) => buyer.source.provenance === "verified" || buyer.relationshipProvenance === "verified");
  const canDraft = hasCurrentSignal(selected.account);
  const recommendation = selected.recommendation;
  const evidence = selected.account.signal.evidence;
  const firmographics = selected.account.firmographics;
  const firmographicFacts = firmographics
    ? [firmographics.industry, firmographics.revenueMillions != null ? selected.account.revenueRange : "Revenue not verified", firmographics.employeeCount ? `${firmographics.employeeCount.toLocaleString()} employees` : undefined, firmographics.hqLocation, firmographics.companyType, firmographics.ticker].filter(Boolean) as string[]
    : [];
  const zoomInfoNeedsConnection = status.zoomInfo && !["mock", "ready"].includes(status.zoomInfo.state);
  const integrationActionLabel = zoomInfoNeedsConnection ? "Set up ZoomInfo" : "Integration settings";

  return <div className="app-shell">
    <div className="top-rule" />
    <header className="app-header">
      <div className="brand-cluster"><div className="brand-lockup"><Image src="/aberdeen-logo.png" alt="Aberdeen Advisors" width={132} height={30} priority /></div><div className="header-copy"><h1>Signal-to-Outreach</h1><p>Turn live buying signals into decision-ready pursuits.</p></div></div>
      <div className="header-actions">{status.diagnostics.slice(0, 2).map((item) => <span className="status-pill" key={item.provider}><span className={`status-dot ${item.configured ? "ready" : ""}`} />{item.provider}: {item.provider === "ZoomInfo" && status.zoomInfo ? status.zoomInfo.state : item.provider === "OpenAI" && item.mode === "mock" ? "templates" : item.mode}</span>)}{status.demoMode && <span className="status-pill demo-pill">Demo mode</span>}<button className="integration-button" aria-label="Open ZoomInfo setup" onClick={() => setDrawerOpen(true)}><Settings2 size={17} /><span>{integrationActionLabel}</span></button></div>
    </header>
    <div className="workspace">
      <aside className={`queue-panel ${mobileDetail ? "mobile-hidden" : ""}`} aria-label="Account queue">
        <div className="queue-header"><div className="eyebrow">Signal queue</div><div className="queue-title-row"><h2>Who to call today</h2><span>{workspaceMetrics.canonicalAccounts} companies · {workspaceMetrics.rows} rows</span></div>
          <button className="refresh-button" onClick={() => refreshSignals()} disabled={refreshing || Boolean(zoomInfoNeedsConnection)}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{refreshing ? "Refreshing signals..." : zoomInfoNeedsConnection ? "Connect ZoomInfo to refresh" : "Refresh signals"}</button>
          <div className="filters"><select aria-label="Sort account queue" value={sort} onChange={(e) => setSort(e.target.value)}><option value="score">Highest score</option><option value="company">Company A-Z</option></select><select aria-label="Filter by industry" value={industry} onChange={(e) => setIndustry(e.target.value)}><option value="all">All industries</option>{industries.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter by signal type" value={signalType} onChange={(e) => setSignalType(e.target.value)}><option value="all">All signals</option>{signalTypes.map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Filter by relationship" value={warmOnly ? "warm" : "all"} onChange={(e) => setWarmOnly(e.target.value === "warm")}><option value="all">All relationships</option><option value="warm">Warm only</option></select></div>
          <p className="refresh-note">Ranked by explainable ICP fit. Unknown evidence earns zero points.</p>
        </div>
        <div className="queue-list">{filtered.map((item) => { const rowWarm = verifiedWarmBuyer(item.account.buyers); return <button key={item.account.id} className={`account-row ${selected.account.id === item.account.id ? "selected" : ""}`} onClick={() => selectAccount(item.account.id)} aria-current={selected.account.id === item.account.id ? "true" : undefined}><div className="account-row-top"><div><div className="account-name">{item.account.name}</div><div className="account-industry">{item.account.industry} · {item.account.revenueRange}</div></div><div className={`score-number ${item.score.total >= 80 ? "high" : ""}`}>{item.score.total}</div></div><div className="account-signal"><SignalIcon size={13} /><span>{liveMode && item.account.signal.source.provenance !== "verified" ? "Signal research pending" : `${item.account.signal.type} / ${item.account.signal.date}`}</span></div><div className="account-meta">{rowWarm ? <span className="badge warm">Warm via {rowWarm.relationshipSource.split(":")[0]}</span> : <span className="badge">Relationship unverified</span>}{item.account.duplicateOf && <span className="badge warning">Possible duplicate</span>}<ChevronRight size={13} style={{ marginLeft: "auto" }} /></div></button>; })}</div>
      </aside>
      <main className={`detail-panel ${mobileDetail ? "mobile-active" : ""}`}>
        <button className="back-button" onClick={() => setMobileDetail(false)}><ArrowLeft size={15} />Back to queue</button>
        <div className="detail-header"><div className="account-heading"><div className="eyebrow">Decision-ready pursuit</div><h2>{selected.account.name}</h2><p>{selected.account.industry} / {selected.account.revenueRange} / {pendingResearch ? "Signal research pending" : `Signal ${selected.account.signal.date}`}</p></div><div className="detail-score"><div className="score-ring" style={{ "--score": selected.score.total } as React.CSSProperties}><strong>{selected.score.total}</strong></div><div className="score-label"><strong>{selected.score.category}</strong><span>ICP fit score</span></div></div></div>
        {selected.account.duplicateOf && <div className="callout-warning" style={{ maxWidth: 1200, margin: "14px auto 0" }}><AlertTriangle size={14} style={{ verticalAlign: "middle", marginRight: 7 }} /><strong>Possible duplicate:</strong> this row shares canonical company ID <code>{selected.account.canonicalCompanyId}</code>. Signal refreshes are deduplicated and metrics count it once.</div>}
        <div className="stage-tabs" role="tablist" aria-label="Pursuit workflow">{stages.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} id={`tab-${item.id}`} className="stage-tab" role="tab" aria-selected={stage === item.id} aria-controls={`panel-${item.id}`} tabIndex={stage === item.id ? 0 : -1} onClick={() => setStage(item.id)} onKeyDown={(event) => onTabKeyDown(event, index)}><span>{index + 1}</span>{item.label}</button>)}</div>
        <section className="content-area" role="tabpanel" id={`panel-${stage}`} aria-labelledby={`tab-${stage}`}>
          {stage === "prioritize" && <><div className="grid-two"><article className="card"><div className="card-header"><div><div className="eyebrow">Why now</div><h3>{pendingResearch ? "Signal research pending" : selected.account.signal.type}</h3></div>{pendingResearch ? <span className="badge">Not researched</span> : provenanceBadge(selected.account.signal.source.provenance)}</div><div className="signal-callout"><strong>{pendingResearch ? "Refresh this account to check for current ZoomInfo signals." : selected.account.signal.summary}</strong><p>{pendingResearch ? "No live trigger has been established for this account." : selected.account.signal.whyNow}</p></div><p>This is a buying-trigger hypothesis, not proof of budget. Confirm the initiative, executive sponsor, timing, and business outcome before advancing.</p>
            {Boolean(evidence.intentTopics.length) && <><h3 style={{ marginTop: 18 }}>Intent topics observed</h3><div className="tag-row">{evidence.intentTopics.map((item) => <span className="tag" key={`${item.topic}-${item.date}`}>{item.topic} · score {item.score} · {item.date}</span>)}</div></>}
            {Boolean(evidence.scoops.length) && <><h3 style={{ marginTop: 18 }}>Recent company events</h3><ul className="evidence-list">{evidence.scoops.map((item, index) => <li key={`${index}-${item.type}-${item.date}`}><strong>{item.type}</strong> · {item.date} — {item.summary}{item.url && <> <a href={item.url} target="_blank" rel="noreferrer">source <ExternalLink size={10} /></a></>}</li>)}</ul></>}
            {Boolean(firmographicFacts.length) && <><h3 style={{ marginTop: 18 }}>Company profile</h3><div className="tag-row">{firmographicFacts.map((fact) => <span className="tag" key={fact}>{fact}</span>)}</div></>}
            {liveMode && <button className="secondary-button" onClick={() => refreshSignals(selected.account.id)} disabled={refreshing || Boolean(zoomInfoNeedsConnection)}>Refresh this account</button>}
            {selected.account.enrichment?.error && <div className="callout-warning">Last refresh failed: {selected.account.enrichment.error}</div>}
            {selected.account.enrichment?.warnings.map((warning) => <div className="callout-warning" key={warning}>{warning}</div>)}
            <div className="source-line"><SignalIcon size={13} />{pendingResearch ? "Awaiting ZoomInfo research" : `${selected.account.signal.source.label} / ${selected.account.signal.date}`}{selected.account.signal.source.url && <a href={selected.account.signal.source.url} target="_blank" rel="noreferrer">View source <ExternalLink size={10} /></a>}</div></article><article className="card"><div className="card-header"><div><div className="eyebrow">Fit score</div><h3>{selected.score.total}/100 · {selected.score.category}</h3></div><span className={`badge ${selected.score.total >= 80 ? "warm" : "indirect"}`}>{selected.score.recommendedAction}</span></div><div className="score-breakdown">{selected.score.components.map((component) => <div className="score-component" key={component.key}><div className="score-component-name">{component.label}</div><div className="score-component-value">{component.earned}/{component.possible}</div><div className="score-bar"><span style={{ width: `${(component.earned / component.possible) * 100}%` }} /></div><div className="component-note">{component.explanation}</div></div>)}</div></article></div><div className="next-action"><button className="primary-button" onClick={advance}>Map buyer and offering <ArrowRight size={15} /></button></div></>}
          {stage === "pursuit" && <><div className="grid-two"><article className="card"><div className="card-header"><div><div className="eyebrow">Buyer map</div><h3>Likely buying committee</h3></div><Users size={20} color="#44b0b1" /></div><div className="buyer-list">{visibleBuyers.length ? visibleBuyers.map((buyer) => <div className="buyer-card" key={buyer.id}><div className="buyer-card-top"><div><h4>{buyer.name}</h4><p>{buyer.title}</p><p>{buyer.decisionRole}{buyer.decisionRoleProvenance === "inferred" ? " · inferred role" : ""}</p></div><span className={`badge ${warmthClass(buyer.relationshipProvenance === "verified" ? buyer.warmth : "Unknown")}`}>{buyer.relationshipProvenance === "verified" ? buyer.warmth : "Relationship unknown"}</span></div><div className="buyer-path"><strong>Suggested path:</strong> {buyer.suggestedPath}<div className="source-line">{provenanceBadge(buyer.source.provenance)} {buyer.source.label}</div><div className="source-line">{buyer.relationshipSource}</div></div></div>) : <div className="callout-warning">No verified buyer is available. Refresh contacts or complete buyer research before choosing a recipient.</div>}</div></article><article className="card"><div className="offering-hero"><div className="eyebrow">Evidence-based offering rules / {recommendation.provenance}</div><h4>{recommendation.recommendedOffering}</h4><p>{recommendation.fitRationale}</p></div><h3>Buyer problem addressed</h3><p>{recommendation.buyerProblem}</p><h3 style={{ marginTop: 18 }}>What to lead with</h3><p>{recommendation.suggestedLeadMessage}</p><div className="tag-row">{recommendation.assumptions.slice(0, 2).map((item) => <span className="tag" key={item}>{item}</span>)}</div><div className="callout-warning"><strong>Supporting credential:</strong> {recommendation.supportingCredential}</div><h3 style={{ marginTop: 18 }}>Evidence used</h3><ul className="evidence-list">{recommendation.evidenceUsed.map((item) => <li key={item}>{item}</li>)}</ul></article></div><div className="next-action"><button className="primary-button" onClick={advance} disabled={!canDraft}>Draft outreach <Sparkles size={15} /></button></div></>}
          {stage === "outreach" && <div className="grid-two"><article className="card"><div className="card-header"><div><div className="eyebrow">First-touch email</div><h3>Ready for human review</h3></div><span className="badge">{activeDraft?.generationMethod === "ai" ? "AI-generated" : "Template-generated"} / {activeDraft?.provenance}</span></div>{!canDraft && <div className="callout-warning">Research required: no current observed trigger supports outreach.</div>}{staleDraft && <div className="callout-warning">Account evidence or the selected recipient has changed. Your draft has been preserved; regenerate it before copying.</div>}{visibleBuyers.some((buyer) => buyer.source.provenance === "verified") && <label className="source-line">Recipient <select className="tone-select" aria-label="Outreach recipient" value={recipientId || ""} disabled={generating} onChange={(event) => setRecipientIds((current) => ({ ...current, [selected.account.id]: event.target.value }))}>{visibleBuyers.filter((buyer) => buyer.source.provenance === "verified").map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.name} / {buyer.title}</option>)}</select></label>}<div className="email-controls"><select className="tone-select" aria-label="Email tone" value={tone} onChange={(e) => setTone(e.target.value as OutreachDraft["tone"])}><option>Direct</option><option>Relationship-led</option><option>Executive</option></select><button className="secondary-button" onClick={regenerate} disabled={generating || !canDraft}>{generating ? <LoaderCircle size={14} /> : <RefreshCw size={14} />}Regenerate</button><button className="primary-button" onClick={copyDraft} disabled={!canDraft || staleDraft || generating || !draftBody.trim()}><Clipboard size={14} />Copy draft</button></div><div className="email-subject"><strong>Subject:</strong>{activeDraft?.subject}</div><textarea className="email-editor" aria-label="Editable outreach email" value={draftBody} disabled={generating || !canDraft} onChange={(e) => { editedAccounts.current.add(selected.account.id); if (!drafts[selected.account.id] && activeDraft) setDrafts((current) => ({ ...current, [selected.account.id]: activeDraft })); setDraftBodies((current) => ({ ...current, [selected.account.id]: e.target.value })); }} /><div className="editor-footer"><span>{draftBody.trim().split(/\s+/).filter(Boolean).length} words</span><span>Not sent / review evidence and recipient details</span></div>{activeDraft?.warnings.map((warning) => <div className="source-line" key={warning}>{warning}</div>)}</article><article className="card"><div className="card-header"><div><div className="eyebrow">Slack alert preview</div><h3>Share the pursuit</h3></div><span className="badge">Preview only</span></div><div className="slack-preview"><div className="slack-title">#growth-signals</div><div className="slack-body"><h4>🔔 New pursuit signal: {selected.slack.account}</h4><div className="slack-field"><strong>Signal</strong><span>{selected.slack.signal}</span></div><div className="slack-field"><strong>ICP score</strong><span>{selected.slack.score}/100 · {selected.score.category}</span></div><div className="slack-field"><strong>Buyer</strong><span>{selected.slack.recommendedBuyer}{warm ? ` · Warm path via ${warm.relationshipSource.split(":")[0]}` : ""}</span></div><div className="slack-field"><strong>Offering</strong><span>{selected.slack.recommendedOffering}</span></div><button className="secondary-button" style={{ marginTop: 14 }} onClick={() => setToast("Preview only—no Slack message was sent.")}>Review pursuit <ChevronRight size={13} /></button></div></div><div className="callout-warning"><Check size={14} style={{ verticalAlign: "middle", marginRight: 7 }} />This preview uses the current account evidence. No Slack message has been sent.</div></article></div>}
        </section>
      </main>
    </div>
    {drawerOpen && <><div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} /><aside className="drawer" aria-label="Integration diagnostics"><div className="drawer-header"><div><div className="eyebrow">ZoomInfo setup</div><h2>Integration status</h2></div><button className="icon-button" aria-label="Close diagnostics" onClick={() => setDrawerOpen(false)}><X size={18} /></button></div><p style={{ fontSize: 11, lineHeight: 1.6 }}>ZoomInfo credentials and encrypted OAuth tokens remain server-side. Once connected, ZoomInfo remains connected through its stored refresh token.</p>{status.zoomInfo && <div className="diagnostic"><div className="diagnostic-top"><strong>ZoomInfo MCP connection</strong><span className={`badge ${status.zoomInfo.state === "ready" ? "warm" : "indirect"}`}>{status.zoomInfo.state}</span></div><p>{status.zoomInfo.liveAccounts} of {status.zoomInfo.totalCanonicalAccounts} canonical accounts currently use live ZoomInfo signals.</p>{status.zoomInfo.lastSuccessfulRefreshAt && <div className="source-line">Last live refresh {new Date(status.zoomInfo.lastSuccessfulRefreshAt).toLocaleString()}</div>}<div style={{ display: "flex", gap: 8, marginTop: 12 }}>{status.zoomInfo.state === "ready" ? <button className="secondary-button" onClick={disconnectZoomInfo}>Disconnect ZoomInfo</button> : status.zoomInfo.state !== "mock" && <button className="primary-button" onClick={connectZoomInfo} disabled={connecting}>Connect ZoomInfo</button>}</div></div>}{status.diagnostics.map((item) => <div className="diagnostic" key={item.provider}><div className="diagnostic-top"><strong>{item.provider}</strong><span className={`badge ${item.configured ? "warm" : "indirect"}`}>{item.mode}</span></div><p>{item.message}</p><div className="source-line">Configuration {item.configured ? "present" : "missing"} · {item.status}</div></div>)}</aside></>}
    {toast && <div className="toast" role="status">{toast}</div>}
  </div>;
}
