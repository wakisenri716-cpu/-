import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { buildTransfer } from "@/lib/transfers/service";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";

const LABEL = { SALARY: "給与振込", GENERAL: "総合振込", BONUS: "賞与振込" } as const;

// 全銀フォーマットの振込データ(Shift_JIS のテキスト)をダウンロードする
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const { file, kind, count, total } = await buildTransfer(companyId, body);
    await audit("振込データを作成", `${LABEL[kind]} ${String(body.date)} ${count}件 ${total.toLocaleString("ja-JP")}円`);
    const name = `${kind === "GENERAL" ? "sogo" : kind === "BONUS" ? "shoyo" : "kyuyo"}_${String(body.date).replaceAll("-", "")}.txt`;
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type": "text/plain; charset=Shift_JIS",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
