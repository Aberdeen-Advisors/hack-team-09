import { NextRequest, NextResponse } from "next/server";
import { validRequestOrigin } from "@/lib/admin-auth";
import { beginZoomInfoAuthorization } from "@/lib/zoominfo-mcp";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    const destination = await beginZoomInfoAuthorization();
    return NextResponse.json({ authorizationUrl: new URL(destination, request.url).toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start ZoomInfo authorization";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
