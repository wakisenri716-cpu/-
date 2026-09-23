import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { importPosSales } from "@/lib/pos/importSales";
import { fetchSmaregiSales, MAX_SYNC_DAYS } from "@/lib/pos/smaregi";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");

  if (!DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json({ error: "期間を正しく指定してください" }, { status: 400 });
  }
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;
  if (days < 1) {
    return NextResponse.json({ error: "終了日は開始日以降にしてください" }, { status: 400 });
  }
  if (days > MAX_SYNC_DAYS) {
    return NextResponse.json({ error: `一度に同期できるのは${MAX_SYNC_DAYS}日間までです` }, { status: 400 });
  }

  try {
    const { sales, demo, fetched } = await fetchSmaregiSales(from, to);
    const result = await importPosSales(companyId, "SMAREGI", sales, { demo });
    return NextResponse.json({ ...result, fetched, skipped: fetched - sales.length, demo });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同期に失敗しました" }, { status: 502 });
  }
}
