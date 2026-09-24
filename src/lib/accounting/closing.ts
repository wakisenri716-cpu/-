import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import { UserError } from "@/lib/errors";
import { fiscalYearOf, getFiscalStartMonth } from "./period";

function dayBefore(key: string) {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

// 締め処理の状態と、よく使う締め日の候補(先月末・前期末)
export async function getClosing(companyId: string, today = jstDateKey(new Date())) {
  const [company, startMonth] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { booksClosedThrough: true } }),
    getFiscalStartMonth(companyId),
  ]);
  const closedThrough = company?.booksClosedThrough ? company.booksClosedThrough.toISOString().slice(0, 10) : null;
  return {
    today,
    closedThrough,
    lastMonthEnd: dayBefore(`${today.slice(0, 7)}-01`),
    lastFiscalYearEnd: dayBefore(fiscalYearOf(today, startMonth).from),
  };
}

// date まで締める(null なら締めを解除)。締めた期間の仕訳はデータベースのトリガーで追加・変更・取消できなくなる。
export async function setBooksClosed(companyId: string, date: string | null, today = jstDateKey(new Date())) {
  if (date === null) {
    await prisma.company.update({ where: { id: companyId }, data: { booksClosedThrough: null } });
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new UserError("締める日付を正しく入力してください");
  if (date >= today) throw new UserError("今日より前の日付までしか締められません");
  const end = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000);
  // 締めるとレビュー待ちの仕訳を承認できなくなるので、先に片付けてもらう
  const [pendingJournals, pendingBank] = await Promise.all([
    prisma.journalEntry.count({ where: { companyId, status: "PENDING_REVIEW", date: { lt: end } } }),
    prisma.bankTransaction.count({ where: { companyId, status: "PENDING", date: { lt: end } } }),
  ]);
  if (pendingJournals || pendingBank) {
    const parts = [pendingJournals ? `レビュー待ちの仕訳 ${pendingJournals}件` : null, pendingBank ? `確認待ちの銀行明細 ${pendingBank}件` : null].filter(Boolean);
    throw new UserError(`締める期間に ${parts.join("・")} が残っています。先に確定してから締めてください`);
  }
  await prisma.company.update({ where: { id: companyId }, data: { booksClosedThrough: new Date(`${date}T00:00:00Z`) } });
  return date;
}
