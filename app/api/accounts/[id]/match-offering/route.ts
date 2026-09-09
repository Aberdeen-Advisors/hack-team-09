import { NextResponse } from "next/server";
import { getAccount } from "@/lib/repository";
import { matchWithFallback } from "@/lib/providers";
import { loadAccounts } from "@/lib/session-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = getAccount((await params).id, await loadAccounts());
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const recommendation = await matchWithFallback(account);
  return NextResponse.json({ recommendation, generationMethod: "rules", fallback: false });
}
