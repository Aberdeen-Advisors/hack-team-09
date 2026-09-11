import { NextRequest, NextResponse } from "next/server";
import { listErrorResponse } from "@/lib/import-http";
import { getTargetList, listWorkspace } from "@/lib/target-lists";
import { loadAccounts } from "@/lib/session-store";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const list = await getTargetList((await params).id);
    return NextResponse.json(listWorkspace(list, await loadAccounts()));
  } catch (error) { return listErrorResponse(error); }
}
