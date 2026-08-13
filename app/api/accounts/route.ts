import { NextResponse } from "next/server";
import { accountMetrics, listAccountDetails } from "@/lib/repository";

export async function GET() {
  return NextResponse.json({ details: listAccountDetails(), metrics: accountMetrics() });
}
