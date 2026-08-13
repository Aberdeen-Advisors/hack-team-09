import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ADMIN_COOKIE_NAME,
  adminConfigurationError,
  adminCookieOptions,
  clearLoginFailures,
  createAdminSessionToken,
  loginRateLimited,
  recordLoginFailure,
  validRequestOrigin,
  verifyAdminPassword,
} from "@/lib/admin-auth";

const bodySchema = z.object({ password: z.string().min(1).max(512) });

export async function POST(request: NextRequest) {
  if (!validRequestOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const configError = adminConfigurationError();
  if (configError) return NextResponse.json({ error: configError }, { status: 503 });
  if (await loginRateLimited(request)) return NextResponse.json({ error: "Too many failed sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !verifyAdminPassword(parsed.data.password)) {
    await recordLoginFailure(request);
    return NextResponse.json({ error: "Invalid administrator password" }, { status: 401 });
  }
  await clearLoginFailures(request);
  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(ADMIN_COOKIE_NAME, createAdminSessionToken(), adminCookieOptions());
  return response;
}
