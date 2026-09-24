import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { createManualJournal, getJournalBook, journalFilterFromParams } from "@/lib/accounting/journal";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? undefined;
  if (month && !MONTH.test(month)) {
    return NextResponse.json({ error: "月の指定が正しくありません" }, { status: 400 });
  }

  // 資本金・借入金など後から追加した科目を、既存デプロイでも選べるようにする
  await ensureChartOfAccounts(companyId);
  const [entries, accounts] = await Promise.all([
    getJournalBook(companyId, { month, filter: journalFilterFromParams(params) }),
    prisma.account.findMany({ where: { companyId, hidden: false }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, category: true } }),
  ]);
  return NextResponse.json({ entries, accounts });
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
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
    await audit("仕訳を入力", `${entry.date.toISOString().slice(0, 10)} ${entry.description}`);
    return NextResponse.json(entry, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
