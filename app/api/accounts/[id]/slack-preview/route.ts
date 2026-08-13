import { NextResponse } from "next/server";
import { offerings } from "@/lib/data";
import { getAccount } from "@/lib/repository";
import { createSlackAlert, matchOfferingMock } from "@/lib/recommendations";
import { scoreAccount } from "@/lib/scoring";
import { loadAccounts } from "@/lib/session-store";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = getAccount((await params).id, await loadAccounts());
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const score = scoreAccount(account);
  const alert = createSlackAlert(account, score.total, matchOfferingMock(account, offerings));
  return NextResponse.json({ alert, sent: false });
}
