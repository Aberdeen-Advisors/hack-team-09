import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest, validRequestOrigin } from "@/lib/admin-auth";
import { beginZoomInfoAuthorization } from "@/lib/zoominfo-mcp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!isAdminRequest(request)) return NextResponse.json({ error: "Administrator sign-in required" }, { status: 401 });
  try {
    const destination = await beginZoomInfoAuthorization();
    return NextResponse.json({ authorizationUrl: new URL(destination, request.url).toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start ZoomInfo authorization";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
