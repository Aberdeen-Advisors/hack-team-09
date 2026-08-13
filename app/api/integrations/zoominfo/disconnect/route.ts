import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, validRequestOrigin } from "@/lib/admin-auth";
import { disconnectZoomInfo } from "@/lib/zoominfo-mcp";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Administrator sign-in required" }, { status: 401 });
  await disconnectZoomInfo();
  return NextResponse.json({ disconnected: true });
}
