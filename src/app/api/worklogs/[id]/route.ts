import { NextResponse } from "next/server";
import { requireMember } from "@/lib/auth/session";
import { deleteWorkLog, updateWorkLog } from "@/lib/workLogs";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  try {
    return NextResponse.json(await updateWorkLog(user.companyId, user.id, id, body));
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const user = await requireMember();
  try {
    const log = await deleteWorkLog(user.companyId, user, id);
    // ほかの人の日報を消したときだけ記録する
    if (log.userId !== user.id) await audit("日報を削除", `${log.user.name} ${log.date.toISOString().slice(0, 10)} ${log.minutes}分`);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
