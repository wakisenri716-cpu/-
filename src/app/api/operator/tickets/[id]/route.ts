import { NextResponse } from "next/server";
import { respond } from "@/lib/shifts/http";
import { operatorAudit, operatorOr404 } from "@/lib/operatorApi";
import { updateTicket } from "@/lib/support";

// { action: "reply", reply } で返信(メール)・{ action: "close" | "reopen" }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await operatorOr404();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const t = await updateTicket(id, body, user);
    await operatorAudit(user, `お問い合わせ「${t.subject}」: ${body.action === "reply" ? "返信" : body.action === "close" ? "対応済み" : "未対応に戻す"}`);
    return { ok: true };
  });
}
