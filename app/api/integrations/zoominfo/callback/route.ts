import { NextRequest, NextResponse } from "next/server";
import { completeZoomInfoAuthorization } from "@/lib/zoominfo-mcp";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await completeZoomInfoAuthorization(request.nextUrl.searchParams);
    return NextResponse.redirect(new URL("/?zoominfo=connected", request.url));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete ZoomInfo authorization";
    return NextResponse.redirect(new URL(`/?zoominfo=error&message=${encodeURIComponent(message)}`, request.url));
  }
}
