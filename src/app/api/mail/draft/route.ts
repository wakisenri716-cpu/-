import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { writeReminderWithAi } from "@/lib/assistant/reminderWriter";
import { buildDraft, type DocumentMailKind } from "@/lib/documentMail";
import { appUrl, mailMode } from "@/lib/mail";
import { UserError } from "@/lib/errors";

const KINDS = new Set(["invoice", "quote", "reminder"]);

// 送信画面に入れておく宛先・件名・本文。督促で ai=1 なら、AIが相手と段階に合わせて書く
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind") ?? "";
  if (!KINDS.has(kind)) return NextResponse.json({ error: "書類の種類が正しくありません" }, { status: 400 });
  try {
    const id = q.get("id") ?? "";
    const draft = kind === "reminder" && q.get("ai") === "1" ? await writeReminderWithAi({ id: user.id, companyId }, id, appUrl(request)) : await buildDraft(companyId, kind as DocumentMailKind, id, appUrl(request));
    return NextResponse.json({ ...draft, mode: mailMode() });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
