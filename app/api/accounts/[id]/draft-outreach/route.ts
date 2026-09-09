import { evidenceKey, hasCurrentSignal } from "@/lib/evidence";
import { NextResponse } from "next/server";
import { z } from "zod";
import { offerings } from "@/lib/data";
import { getAccount } from "@/lib/repository";
import { matchOffering } from "@/lib/recommendations";
import { outreachWithFallback, providers } from "@/lib/providers";
import { loadAccounts } from "@/lib/session-store";

const requestSchema = z.object({ evidenceKey: z.string().optional(), buyerId: z.string().optional(), tone: z.enum(["Direct", "Relationship-led", "Executive"]).default("Direct") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = getAccount((await params).id, await loadAccounts());
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid tone", issues: parsed.error.issues }, { status: 400 });
  if (!hasCurrentSignal(account)) return NextResponse.json({ error: "A current observed signal is required before drafting outreach." }, { status: 409 });
  if (parsed.data.evidenceKey && parsed.data.evidenceKey !== evidenceKey(account)) return NextResponse.json({ error: "Account evidence changed. Refresh the account view before generating outreach." }, { status: 409 });
  const buyer = parsed.data.buyerId ? account.buyers.find((item) => item.id === parsed.data.buyerId && item.source.provenance === "verified") : undefined;
  if (parsed.data.buyerId && !buyer) return NextResponse.json({ error: "Choose a verified contact for this account." }, { status: 400 });
  const draftAccount = buyer ? { ...account, buyers: [buyer, ...account.buyers.filter((item) => item.id !== buyer.id)] } : account;
  const recommendation = matchOffering(account, offerings);
  const draft = await outreachWithFallback(draftAccount, recommendation, parsed.data.tone);
  return NextResponse.json({ draft: { ...draft, evidenceKey: evidenceKey(account) }, fallback: !providers().useOpenAIMock && draft.generationMethod === "template" });
}
