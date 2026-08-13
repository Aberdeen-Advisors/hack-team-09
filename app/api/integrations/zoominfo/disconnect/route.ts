import { NextRequest, NextResponse } from "next/server";
import { validRequestOrigin } from "@/lib/admin-auth";
import { disconnectZoomInfo } from "@/lib/zoominfo-mcp";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  await disconnectZoomInfo();
  return NextResponse.json({ disconnected: true });
}
