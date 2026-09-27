import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { setCustomItems } from "@/lib/monthlyClose";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 会社で足す確認項目を保存する
export async function PUT(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const items = await setCustomItems(companyId, body.items);
    await audit("月次決算の確認項目を変更", items.join("、") || "なし");
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
