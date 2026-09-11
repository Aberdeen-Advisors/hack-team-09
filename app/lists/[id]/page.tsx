import { notFound } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getTargetList, ListError, listWorkspace } from "@/lib/target-lists";
import { loadAccounts } from "@/lib/session-store";
import { integrationStatus } from "@/lib/providers";
import type { WorkspaceStage } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export default async function ListWorkspacePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ account?: string; stage?: string }> }) {
  const list = await getTargetList((await params).id).catch((error) => { if (error instanceof ListError && error.status === 404) notFound(); throw error; });
  const workspace = listWorkspace(list, await loadAccounts());
  const query = await searchParams;
  const stage = (["prioritize", "pursuit", "outreach"] as string[]).includes(query.stage || "") ? query.stage as WorkspaceStage : "prioritize";
  return <Dashboard initialDetails={workspace.details} initialStatus={await integrationStatus(true)} metrics={workspace.metrics} initialStage={stage} initialAccountId={query.account} targetList={list} />;
}
