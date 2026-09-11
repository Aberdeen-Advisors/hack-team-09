import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { loadAccounts } from "@/lib/session-store";
import { validRequestOrigin } from "@/lib/admin-auth";
import { integrationStatus, providers } from "@/lib/providers";
import { accountMetrics, listAccountDetails } from "@/lib/repository";
import { refreshZoomInfoAccounts, ZoomInfoRefreshInProgressError, zoomInfoIntegrationSnapshot, zoomInfoMode } from "@/lib/zoominfo-mcp";
import { accountsForList, getTargetList, listWorkspace, visibleAccounts } from "@/lib/target-lists";
import type { TargetList } from "@/lib/schemas";

// ZoomInfo tool calls are spaced to stay inside its per-second quota, so a full refresh
// takes appreciably longer than the platform's default function budget allows.
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const body = z.object({ accountId: z.string().min(1).optional(), listId: z.string().min(1).optional(), accountIds: z.array(z.string().min(1)).min(1).max(5).optional(), force: z.boolean().optional() }).strict()
    .refine((value) => !value.accountIds || Boolean(value.listId) && !value.accountId)
    .refine((value) => !value.listId || Boolean(value.accountIds || value.accountId))
    .safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid refresh request" }, { status: 400 });
  if (body.data.accountId && !(await loadAccounts()).some((account) => account.id === body.data.accountId)) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  let list: TargetList | undefined;
  if (body.data.listId) {
    try { list = await getTargetList(body.data.listId); } catch { return NextResponse.json({ error: "Target list not found" }, { status: 404 }); }
    const members = new Set(list.memberships.map((item) => item.accountId));
    if ((body.data.accountIds || [body.data.accountId!]).some((id) => !members.has(id))) return NextResponse.json({ error: "Account is not a member of this list" }, { status: 400 });
    if (zoomInfoMode() !== "mcp") return NextResponse.json({ error: "Connect live ZoomInfo to enrich imported accounts" }, { status: 409 });
  }
  if (zoomInfoMode() === "mcp") {
    const before = await zoomInfoIntegrationSnapshot(true);
    if (before.state !== "ready") return NextResponse.json({ error: before.error || "Connect ZoomInfo before refreshing live signals", status: await integrationStatus(true) }, { status: 409 });
    try {
      const result = await refreshZoomInfoAccounts(body.data.accountId, body.data.accountIds ? { accountIds: body.data.accountIds, listId: body.data.listId, force: body.data.force } : undefined);
      const scoped = list ? accountsForList(list, result.accounts) : await visibleAccounts();
      const details = listAccountDetails(scoped);
      return NextResponse.json({
        signalCount: result.summary.updated,
        deduplicatedRows: result.accounts.length - new Set(result.accounts.map((account) => account.canonicalCompanyId)).size,
        fallback: false,
        featuredAccountId: body.data.accountId || details[0]?.account.id,
        details,
        metrics: accountMetrics(scoped),
        refresh: result.summary,
        status: await integrationStatus(true),
      });
    } catch (error) {
      const status = error instanceof ZoomInfoRefreshInProgressError ? 409 : 502;
      const latest = await loadAccounts();
      const visible = list ? latest : await visibleAccounts();
      const scoped = list ? listWorkspace(list, latest) : { details: listAccountDetails(visible), metrics: accountMetrics(visible) };
      return NextResponse.json({ error: error instanceof Error ? error.message : "ZoomInfo refresh failed", ...scoped, status: await integrationStatus(true) }, { status });
    }
  }
  const selected = providers();
  const accounts = await visibleAccounts();
  const signals = await selected.signal.refresh(accounts);
  const details = listAccountDetails(accounts);
  return NextResponse.json({
    signalCount: signals.length,
    deduplicatedRows: accounts.length - signals.length,
    fallback: false,
    featuredAccountId: body.data.accountId || details[0]?.account.id,
    details,
    metrics: accountMetrics(accounts),
    refresh: { selected: signals.length, updated: signals.length, cached: 0, unchanged: 0, failed: [], estimatedCompanyCredits: 0 },
    status: await integrationStatus(true),
  });
}
