import { NextResponse } from "next/server";
import { accounts } from "@/lib/data";
import { integrationStatus, providers } from "@/lib/providers";
import { listAccountDetails } from "@/lib/repository";

export async function POST() {
  const selected = providers();
  let fallback = selected.useZoomMock;
  let signals;
  try { signals = await selected.signal.refresh(accounts); }
  catch {
    fallback = true;
    const { MockSignalProvider } = await import("@/lib/providers");
    signals = await new MockSignalProvider().refresh(accounts);
  }
  const details = listAccountDetails();
  return NextResponse.json({
    signalCount: signals.length,
    deduplicatedRows: accounts.length - signals.length,
    fallback,
    featuredAccountId: details[0]?.account.id,
    details,
    status: integrationStatus(),
  });
}
