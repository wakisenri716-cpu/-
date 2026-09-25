import { NextResponse } from "next/server";
import { requireCompanyId, requireUser } from "@/lib/auth/session";
import { sendDocumentMail, type DocumentMailKind } from "@/lib/documentMail";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

const KINDS = new Set(["invoice", "quote", "reminder"]);
const LABEL: Record<DocumentMailKind, string> = { invoice: "請求書", quote: "見積書", reminder: "督促" };

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  const kind = String(body.kind ?? "");
  if (!KINDS.has(kind)) return NextResponse.json({ error: "書類の種類が正しくありません" }, { status: 400 });
  try {
    const log = await sendDocumentMail(companyId, { kind: kind as DocumentMailKind, id: String(body.id ?? ""), to: body.to, subject: body.subject, body: body.body }, user.name);
    await audit(`${LABEL[kind as DocumentMailKind]}をメールで送信`, `${log.to} ${log.status === "SENT" ? "" : `(${log.status === "TEST" ? "テストモード" : "失敗"})`}`.trim());
    if (log.status === "FAILED") return NextResponse.json({ error: `送信できませんでした: ${log.error ?? ""}`, log }, { status: 502 });
    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
