import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { importJson, listErrorResponse } from "@/lib/import-http";
import { changeTargetList, getTargetList, importTargetList } from "@/lib/target-lists";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try { return NextResponse.json({ list: await getTargetList((await context.params).id) }); } catch (error) { return listErrorResponse(error); }
}
export async function PUT(request: NextRequest, context: Context) {
  try { return NextResponse.json({ list: await importTargetList(await importJson(request), (await context.params).id) }); } catch (error) { return listErrorResponse(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    const body = z.object({ name: z.string(), revision: z.number().int().positive() }).strict().parse(await importJson(request));
    await changeTargetList((await context.params).id, body);
    return NextResponse.json({ ok: true });
  } catch (error) { return listErrorResponse(error); }
}
export async function DELETE(request: NextRequest, context: Context) {
  try {
    const body = z.object({ revision: z.number().int().positive() }).strict().parse(await importJson(request));
    await changeTargetList((await context.params).id, { delete: true, ...body });
    return NextResponse.json({ ok: true });
  } catch (error) { return listErrorResponse(error); }
}
