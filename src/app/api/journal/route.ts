import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultCompanyId } from "@/lib/demo";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { createManualJournal, getJournalBook, JournalError } from "@/lib/accounting/journal";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const companyId = await getDefaultCompanyId();
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  if (month && !MONTH.test(month)) {
    return NextResponse.json({ error: "月の指定が正しくありません" }, { status: 400 });
  }

  // 資本金・借入金など後から追加した科目を、既存デプロイでも選べるようにする
  await ensureChartOfAccounts(companyId);
  const [entries, accounts] = await Promise.all([
    getJournalBook(companyId, { month }),
    prisma.account.findMany({ where: { companyId }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, category: true } }),
  ]);
  return NextResponse.json({ entries, accounts });
}

export async function POST(request: Request) {
  const companyId = await getDefaultCompanyId();
  const body = await request.json().catch(() => ({}));
  const lines = Array.isArray(body.lines) ? body.lines : [];

  try {
    const entry = await createManualJournal(companyId, {
      date: new Date(String(body.date ?? "")),
      description: String(body.description ?? ""),
      lines: lines.map((l: Record<string, unknown>) => ({
        accountId: String(l.accountId ?? ""),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
        memo: l.memo ? String(l.memo) : null,
      })),
    });
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    if (error instanceof JournalError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
