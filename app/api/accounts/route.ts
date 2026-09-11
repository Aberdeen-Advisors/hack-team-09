import { NextResponse } from "next/server";
import { accountMetrics, listAccountDetails } from "@/lib/repository";
import { visibleAccounts } from "@/lib/target-lists";

export async function GET() {
  const accounts = await visibleAccounts();
  return NextResponse.json({ details: listAccountDetails(accounts), metrics: accountMetrics(accounts) });
}
