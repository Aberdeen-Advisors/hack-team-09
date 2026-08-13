import { NextResponse } from "next/server";
import { accountMetrics, listAccountDetails } from "@/lib/repository";
import { loadAccounts } from "@/lib/session-store";

export async function GET() {
  const accounts = await loadAccounts();
  return NextResponse.json({ details: listAccountDetails(accounts), metrics: accountMetrics(accounts) });
}
