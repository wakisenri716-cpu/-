import { NextResponse } from "next/server";
import { respond } from "@/lib/shifts/http";
import { operatorAudit, operatorOr404 } from "@/lib/operatorApi";
import { endNotice } from "@/lib/support";

// お知らせの表示を終える
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await operatorOr404();
  if (user instanceof NextResponse) return user;
  return respond(async () => {
    const n = await endNotice(id);
    await operatorAudit(user, `お知らせの表示を終えた: ${n.title}`);
    return { ok: true };
  });
}
