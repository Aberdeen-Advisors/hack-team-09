import { NextResponse } from "next/server";
import { getAccountDetail } from "@/lib/repository";
import { loadAccounts } from "@/lib/session-store";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = getAccountDetail(id, "Direct", await loadAccounts());
  return detail ? NextResponse.json(detail) : NextResponse.json({ error: "Account not found" }, { status: 404 });
}
