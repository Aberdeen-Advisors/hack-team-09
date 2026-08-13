import { Dashboard } from "@/components/dashboard";
import { accountMetrics, listAccountDetails } from "@/lib/repository";
import { integrationStatus } from "@/lib/providers";
import { loadAccounts } from "@/lib/session-store";
import type { WorkspaceStage } from "@/lib/schemas";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ account?: string; stage?: string }> }) {
  const accounts = await loadAccounts();
  const details = listAccountDetails(accounts);
  const query = await searchParams;
  const initialAccountId = details.some((item) => item.account.id === query.account) ? query.account : details[0]?.account.id;
  const initialStage = (["prioritize", "pursuit", "outreach"] as const).includes(query.stage as WorkspaceStage) ? query.stage as WorkspaceStage : "prioritize";
  return <Dashboard initialDetails={details} initialStatus={await integrationStatus(true)} metrics={accountMetrics(accounts)} initialAccountId={initialAccountId} initialStage={initialStage} />;
}
