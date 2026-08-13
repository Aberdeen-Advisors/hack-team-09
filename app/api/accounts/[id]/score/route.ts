import { NextResponse } from "next/server";
import { getAccount } from "@/lib/repository";
import { scoreAccount } from "@/lib/scoring";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = getAccount((await params).id);
  return account ? NextResponse.json({ score: scoreAccount(account) }) : NextResponse.json({ error: "Account not found" }, { status: 404 });
}
