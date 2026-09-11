import { NextRequest, NextResponse } from "next/server";
import { validRequestOrigin } from "@/lib/admin-auth";
import { ListError } from "@/lib/target-lists";

export function requireOrigin(request: NextRequest) {
  if (!validRequestOrigin(request)) throw new ListError("Invalid request origin", 403);
}
export function listErrorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update target lists", ...(error instanceof ListError && error.errors ? { errors: error.errors } : {}) }, { status: error instanceof ListError ? error.status : 400 });
}
export async function boundedBody(request: NextRequest, limit: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) throw new ListError("Request body is required");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new ListError("Upload exceeds the size limit", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new Uint8Array(Buffer.concat(chunks));
}
export async function importJson(request: NextRequest): Promise<unknown> {
  requireOrigin(request);
  return JSON.parse(new TextDecoder().decode(await boundedBody(request, 4 * 1024 * 1024)));
}
