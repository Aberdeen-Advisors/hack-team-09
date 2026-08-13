import type { NextRequest } from "next/server";

export function validRequestOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host");
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const protocol = forwardedProtocol || requestUrl.protocol.replace(":", "");
    const accepted = new Set([requestUrl.origin]);
    if (host) accepted.add(`${protocol}://${host}`);
    return accepted.has(new URL(origin).origin);
  } catch { return false; }
}
