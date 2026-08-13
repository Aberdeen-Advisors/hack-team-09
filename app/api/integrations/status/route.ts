import { NextResponse } from "next/server";
import { integrationStatus } from "@/lib/providers";

export async function GET() {
  return NextResponse.json(integrationStatus());
}
