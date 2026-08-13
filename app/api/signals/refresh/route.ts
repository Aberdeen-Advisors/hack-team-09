import { NextRequest, NextResponse } from "next/server";
import { accounts } from "@/lib/data";
import { validRequestOrigin } from "@/lib/admin-auth";
import { integrationStatus, providers } from "@/lib/providers";
import { accountMetrics, listAccountDetails } from "@/lib/repository";
import { refreshZoomInfoAccounts, ZoomInfoRefreshInProgressError, zoomInfoIntegrationSnapshot, zoomInfoMode } from "@/lib/zoominfo-mcp";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (zoomInfoMode() === "mcp") {
    const before = await zoomInfoIntegrationSnapshot(true);
    if (before.state !== "ready") return NextResponse.json({ error: before.error || "Connect ZoomInfo before refreshing live signals", status: await integrationStatus(true) }, { status: 409 });
    try {
      const result = await refreshZoomInfoAccounts();
      const details = listAccountDetails(result.accounts);
      return NextResponse.json({
        signalCount: result.summary.updated,
        deduplicatedRows: result.accounts.length - new Set(result.accounts.map((account) => account.canonicalCompanyId)).size,
        fallback: false,
        featuredAccountId: details[0]?.account.id,
        details,
        metrics: accountMetrics(result.accounts),
        refresh: result.summary,
        status: await integrationStatus(true),
      });
    } catch (error) {
      const status = error instanceof ZoomInfoRefreshInProgressError ? 409 : 502;
      return NextResponse.json({ error: error instanceof Error ? error.message : "ZoomInfo refresh failed", status: await integrationStatus(true) }, { status });
    }
  }
  const selected = providers();
  const signals = await selected.signal.refresh(accounts);
  const details = listAccountDetails();
  return NextResponse.json({
    signalCount: signals.length,
    deduplicatedRows: accounts.length - signals.length,
    fallback: false,
    featuredAccountId: details[0]?.account.id,
    details,
    metrics: accountMetrics(),
    refresh: { selected: signals.length, updated: signals.length, cached: 0, unchanged: 0, failed: [], estimatedCompanyCredits: 0 },
    status: await integrationStatus(true),
  });
}
