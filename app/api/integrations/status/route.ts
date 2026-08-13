import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin-auth";
import { integrationStatus } from "@/lib/providers";

export async function GET(request: NextRequest) {
  return NextResponse.json(await integrationStatus(isAdminRequest(request)));
}
