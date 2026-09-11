"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Download, FileUp, FolderOpen, LoaderCircle, Plus, X } from "lucide-react";
import type { IntegrationStatus, TargetListSummary } from "@/lib/schemas";
import type { ImportPreview } from "@/lib/target-import";

type Modal = { mode: "upload" | "rename" | "delete"; list?: TargetListSummary };
export function ListManager({ initialLists, initialStatus }: { initialLists: TargetListSummary[]; initialStatus: IntegrationStatus }) {
  const [lists, setLists] = useState(initialLists);
  const [modal, setModal] = useState<Modal>();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [connecting, setConnecting] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewRequest = useRef(0);
  useEffect(() => {
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const message = query.get("zoominfo") === "connected" ? "ZoomInfo connected. Open a list to enrich its accounts." : query.get("zoominfo") === "error" ? query.get("message") || "ZoomInfo connection failed" : "";
    if (message) { const timer = setTimeout(() => setNotice(message), 0); return () => clearTimeout(timer); }
  }, []);
  function open(next: Modal) {
    setModal(next); setName(next.list?.name || ""); setFile(undefined); setPreview(undefined); setError("");
  }
  function close() { if (!busy) { previewRequest.current++; setModal(undefined); } }
  async function refreshLists() {
    const response = await fetch("/api/target-lists", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Unable to load lists");
    setLists(payload.lists);
  }
  async function chooseFile(next?: File) {
    if (!next || busy) return;
    setFile(next); setPreview(undefined); setError("");
    if (!modal?.list) setName(next.name.replace(/\.[^.]+$/, ""));
    if (!/\.(csv|xlsx)$/i.test(next.name) || next.size > 4 * 1024 * 1024) { setError("Choose a CSV or XLSX file up to 4 MB."); return; }
    setBusy(true);
    const requestId = ++previewRequest.current;
    try {
      const data = new FormData(); data.append("file", next);
      const response = await fetch("/api/target-lists/import/preview", { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to read file");
      if (requestId === previewRequest.current) setPreview(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to preview file"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!modal || busy) return;
    setBusy(true); setError("");
    try {
      const replacing = Boolean(modal.list);
      const url = `/api/target-lists${modal.list ? `/${modal.list.id}` : ""}`;
      const body = modal.mode === "upload" ? { name, filename: file?.name, rows: preview?.rows, ...(modal.list ? { revision: modal.list.revision } : {}) } : modal.mode === "rename" ? { name, revision: modal.list?.revision } : { revision: modal.list?.revision };
      const response = await fetch(url, { method: modal.mode === "upload" ? replacing ? "PUT" : "POST" : modal.mode === "rename" ? "PATCH" : "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.errors && preview) setPreview({ ...preview, errors: payload.errors });
        throw new Error(payload.error || "Unable to save list");
      }
      await refreshLists();
      setNotice(modal.mode === "delete" ? "List deleted. Company evidence is retained for reuse." : modal.mode === "rename" ? "List renamed." : `${replacing ? "List replaced" : "List imported"}. Open the list when you are ready to enrich accounts.`);
      setModal(undefined);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save list"); }
    finally { setBusy(false); }
  }
  async function connect() {
    setConnecting(true);
    try {
      const response = await fetch("/api/integrations/zoominfo/connect", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to connect ZoomInfo");
      window.location.assign(payload.authorizationUrl);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to connect"); setConnecting(false); }
  }
  const ready = initialStatus.zoomInfo?.state === "ready";
  const mode = initialStatus.zoomInfo?.state || "not configured";
  return <div className="app-shell">
    <div className="top-rule" />
    <header className="app-header"><div className="brand-cluster"><div className="brand-lockup"><Image src="/aberdeen-logo.png" alt="Aberdeen Advisors" width={132} height={30} priority /></div><div className="header-copy"><h1>Target lists</h1><p>Organize your accounts. Research the right companies.</p></div></div><span className="status-pill">ZoomInfo: {mode}</span></header>
    <main className="list-manager">
      <div className="list-toolbar"><div><div className="eyebrow">Signal-to-Outreach</div><h2>Your target lists</h2><p>Upload a CSV or Excel file, review the accounts, then choose when to enrich them.</p></div><button className="primary-button" onClick={() => open({ mode: "upload" })}><Plus size={17} />Upload new list</button></div>
      {!ready && <div className="list-connection"><div><strong>Import now, enrich when ZoomInfo is connected.</strong><p>{mode === "mock" ? "This workspace is in demo mode. Live ZoomInfo must be enabled before enrichment." : "Your lists can be uploaded and managed while ZoomInfo is disconnected."}</p></div>{mode !== "mock" && <button className="secondary-button" onClick={connect} disabled={connecting}>{connecting ? "Connecting…" : "Connect ZoomInfo"}</button>}</div>}
      {notice && <p role="status" className="list-notice">{notice}</p>}
      {!lists.length && <div className="card list-empty"><FolderOpen size={34} /><h3>Create your first target list</h3><p>Start with account_name and website. Add your targeting context in the optional columns.</p><a href="/target-list-template.csv" download>Download CSV template</a></div>}
      <div className="list-grid">{lists.map((list) => <article className="card list-card" key={list.id} aria-label={list.name}>
        <div className="eyebrow">Named target list</div><h3>{list.name}</h3><p className="list-date">Updated {new Date(list.updatedAt).toLocaleDateString()}</p>
        <dl className="list-counts"><div><dt>Accounts</dt><dd>{list.total}</dd></div><div><dt>Verified</dt><dd>{list.verified}</dd></div><div><dt>Pending</dt><dd>{list.pending}</dd></div><div><dt>Failed</dt><dd>{list.failed}</dd></div></dl>
        <Link href={`/lists/${list.id}`} className="primary-button">Open list <ArrowRight size={15} /></Link>
        <div className="list-card-actions"><button onClick={() => open({ mode: "upload", list })}>Replace from file</button><button onClick={() => open({ mode: "rename", list })}>Rename</button><button onClick={() => open({ mode: "delete", list })}>Delete</button></div>
      </article>)}</div>
    </main>
    <dialog ref={dialog} className="import-dialog" aria-labelledby="list-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
      {modal && <><div className="drawer-header"><h2 id="list-dialog-title">{modal.mode === "delete" ? "Delete list" : modal.mode === "rename" ? "Rename list" : modal.list ? "Replace list from file" : "Upload target list"}</h2><button className="icon-button" onClick={close} disabled={busy} aria-label="Close list dialog"><X size={18} /></button></div>
        {modal.mode !== "delete" && <label className="list-field">List name<input autoFocus value={name} maxLength={100} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>}
        {modal.mode === "upload" && <>
          {modal.list && <p className="callout-warning">This replaces all memberships in “{modal.list.name}”. Shared company evidence is retained.</p>}
          <div className="upload-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void chooseFile(event.dataTransfer.files[0]); }}>
            <FileUp size={28} /><label className="list-field">CSV or XLSX file<input type="file" accept=".csv,.xlsx" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} /></label><p>Drop a file here or choose one. Maximum 4 MB / 500 accounts.</p>
          </div>
          <p className="format-help">Required: <code>account_name</code> and <code>website</code>. Optional: <code>zoominfo_company_id</code>, <code>vertical</code>, <code>tier</code>, <code>relationship_status</code>, <code>suggested_entry_offer</code>. XLSX imports use the first worksheet and plain text or numeric cells.</p>
          <a href="/target-list-template.csv" download className="template-link"><Download size={15} />Download CSV template</a>
          {busy && <p role="status"><LoaderCircle className="spin" size={16} />Processing…</p>}
          {preview && <section aria-label="Import preview"><h3>Import preview</h3><p>{preview.classifications.filter((row) => row.status === "new").length} new · {preview.classifications.filter((row) => row.status === "reused").length} reused · {preview.classifications.filter((row) => row.status === "duplicate").length} duplicates · {preview.errors.length} errors</p>
            {preview.warnings.map((warning) => <p key={warning} className="callout-warning">{warning}</p>)}
            {!!preview.errors.length && <div className="import-errors" role="alert"><strong>Fix every error and upload the corrected file.</strong><ul>{preview.errors.map((issue, index) => <li key={index}>Row {issue.row || "—"}, {issue.column}: {issue.message}</li>)}</ul></div>}
            <div className="preview-table"><table><thead><tr><th>Row</th><th>Account</th><th>Result</th></tr></thead><tbody>{preview.classifications.map((row, index) => <tr key={index}><td>{row.row}</td><td>{row.name}</td><td>{row.status}</td></tr>)}</tbody></table></div>
          </section>}
        </>}
        {modal.mode === "delete" && <p>Delete “{modal.list?.name}”? Its memberships will be removed. Shared company records and ZoomInfo evidence remain available for future imports.</p>}
        {error && <p role="alert" className="import-errors">{error}</p>}
        <div className="dialog-actions"><button className="secondary-button" onClick={close} disabled={busy}>Cancel</button><button className="primary-button" onClick={save} disabled={busy || (modal.mode !== "delete" && !name.trim()) || (modal.mode === "upload" && (!preview || !!preview.errors.length || !preview.rows.length))}>{modal.mode === "delete" ? "Delete list" : modal.mode === "rename" ? "Save name" : modal.list ? "Replace list" : "Import list"}</button></div>
      </>}
    </dialog>
  </div>;
}
