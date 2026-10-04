import { NextResponse } from "next/server";
import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { bookCash, listCashCounts, recordCashCount } from "@/lib/accounting/cashCount";
import { audit } from "@/lib/audit";

// 一覧と今日の帳簿の現金。?date=YYYY-MM-DD でその日の帳簿の現金だけ
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const date = new URL(request.url).searchParams.get("date");
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "日付が正しくありません" }, { status: 400 });
    return respond(async () => ({ date, book: await bookCash(companyId, date) }));
  }
  return respond(() => listCashCounts(companyId));
}

// { date, counts: { "10000": 枚数, … }, note, adjust }
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await recordCashCount(companyId, user, body);
    await audit("現金の実査", `実際 ${r.counted.toLocaleString()}円・帳簿 ${r.book.toLocaleString()}円・差 ${r.diff.toLocaleString()}円${r.journalEntryId ? "(帳簿を合わせた)" : ""}`);
    return { id: r.id, counted: r.counted, book: r.book, diff: r.diff, adjusted: !!r.journalEntryId };
  }, 201);
}
