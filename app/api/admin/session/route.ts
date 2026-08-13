import { NextRequest, NextResponse } from "next/server";
import { adminConfigurationError, isAdminRequest } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: isAdminRequest(request), configured: !adminConfigurationError() });
}
