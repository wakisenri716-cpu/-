import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { buildDraft, type DocumentMailKind } from "@/lib/documentMail";
import { appUrl, mailMode } from "@/lib/mail";
import { UserError } from "@/lib/errors";

const KINDS = new Set(["invoice", "quote", "reminder"]);

// 送信画面に入れておく宛先・件名・本文
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const q = new URL(request.url).searchParams;
  const kind = q.get("kind") ?? "";
  if (!KINDS.has(kind)) return NextResponse.json({ error: "書類の種類が正しくありません" }, { status: 400 });
  try {
    const draft = await buildDraft(companyId, kind as DocumentMailKind, q.get("id") ?? "", appUrl(request));
    return NextResponse.json({ ...draft, mode: mailMode() });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
