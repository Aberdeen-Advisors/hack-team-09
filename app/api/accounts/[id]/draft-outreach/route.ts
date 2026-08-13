import { NextResponse } from "next/server";
import { z } from "zod";
import { offerings } from "@/lib/data";
import { getAccount } from "@/lib/repository";
import { matchOfferingMock } from "@/lib/recommendations";
import { outreachWithFallback, providers } from "@/lib/providers";

const requestSchema = z.object({ tone: z.enum(["Direct", "Relationship-led", "Executive"]).default("Direct") });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const account = getAccount((await params).id);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid tone", issues: parsed.error.issues }, { status: 400 });
  const recommendation = matchOfferingMock(account, offerings);
  const draft = await outreachWithFallback(account, recommendation, parsed.data.tone);
  return NextResponse.json({ draft, fallback: providers().useOpenAIMock || draft.provenance === "demo" });
}
