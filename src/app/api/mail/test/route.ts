import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { sendMail, MODE_LABELS, mailMode } from "@/lib/mail";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 設定が正しいか確かめるための試し送信(管理者のみ)
export async function POST(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  try {
    const log = await sendMail({
      companyId: admin.companyId,
      kind: "TEST",
      to: String(body.to ?? admin.email),
      subject: "【テスト】経理AIからのメール送信の確認",
      text: ["このメールは、経理AIのメール送信の設定を確認するためのテストです。", "", `送信方法: ${MODE_LABELS[mailMode()]}`, "", "届いていれば、設定は完了しています。"].join("\n"),
      sentByName: admin.name,
    });
    await audit("テストメールを送信", `${log.to}(${log.status})`);
    if (log.status === "FAILED") return NextResponse.json({ error: `送信できませんでした: ${log.error ?? ""}` }, { status: 502 });
    return NextResponse.json(log, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
