import { NextRequest, NextResponse } from "next/server";
import { importJson, listErrorResponse } from "@/lib/import-http";
import { importTargetList, listSummaries } from "@/lib/target-lists";

export async function GET() {
  try { return NextResponse.json({ lists: await listSummaries() }); } catch (error) { return listErrorResponse(error); }
}
export async function POST(request: NextRequest) {
  try { return NextResponse.json({ list: await importTargetList(await importJson(request)) }, { status: 201 }); }
  catch (error) { return listErrorResponse(error); }
}
