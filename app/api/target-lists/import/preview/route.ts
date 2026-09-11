import { NextRequest, NextResponse } from "next/server";
import { boundedBody, listErrorResponse, requireOrigin } from "@/lib/import-http";
import { MAX_IMPORT_BYTES, parseTargetFile } from "@/lib/target-import";
import { loadAccounts } from "@/lib/session-store";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    requireOrigin(request);
    const bytes = await boundedBody(request, MAX_IMPORT_BYTES + 65536);
    const form = await new Response(bytes as BodyInit, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a CSV or XLSX file");
    return NextResponse.json(await parseTargetFile(file.name, Buffer.from(await file.arrayBuffer()), await loadAccounts()));
  } catch (error) { return listErrorResponse(error); }
}
