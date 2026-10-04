import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { getCurrentUser } from "@/lib/auth/session";
import { billingEnabled, billingState, BILLING_SELECT, trialEnd } from "@/lib/billing";
import { plans } from "@/lib/billing/plans";

// 運営者メニュー: このサービスを運営する人(OPERATOR_EMAILS に入れたメールアドレス)だけが見られる。
// 申し込んだ会社の一覧・契約の状態・売上の見込み・無料期間の延長・本番のエラー。

function operatorEmails() {
  return (process.env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isOperator(email: string | null | undefined) {
  return !!email && operatorEmails().includes(email.toLowerCase());
}

// 運営者でなければ「ないページ」にする(運営者メニューがあることも知らせない)
export async function requireOperator() {
  const user = await getCurrentUser();
  if (!user || !isOperator(user.email)) notFound();
  return user;
}

export const PHASE_LABELS: Record<string, string> = {
  off: "課金なし",
  free: "無料(運営者が設定)",
  trial: "無料期間中",
  active: "契約中",
  past_due: "支払い失敗",
  expired: "期限切れ",
};

export async function listCompanies(q?: string | null) {
  const companies = await prisma.company.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { members: { some: { role: "ADMIN", user: { email: { contains: q, mode: "insensitive" } } } } }] } : {},
    select: {
      id: true,
      name: true,
      stripeCustomerId: true,
      ...BILLING_SELECT,
      members: { where: { active: true }, select: { role: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } },
      _count: { select: { journalEntries: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  // 最後に使われた日(ログイン中の端末の最終利用と、操作ログの新しいほう)
  const ids = companies.map((c) => c.id);
  const [sessions, audits] = await Promise.all([
    prisma.session.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { lastSeenAt: true, createdAt: true } }),
    prisma.auditLog.groupBy({ by: ["companyId"], where: { companyId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const lastSeen = new Map<string, Date>();
  const touch = (id: string | null, d: Date | null | undefined) => {
    if (id && d && (!lastSeen.has(id) || lastSeen.get(id)! < d)) lastSeen.set(id, d);
  };
  for (const s of sessions) touch(s.companyId, s._max.lastSeenAt ?? s._max.createdAt);
  for (const a of audits) touch(a.companyId, a._max.createdAt);
  const freeEmails = (process.env.BILLING_FREE_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return companies.map((c) => {
    const state = billingState(c);
    const admins = c.members.filter((m) => m.role === "ADMIN").map((m) => m.user);
    const envFree = state.phase !== "off" && state.phase !== "free" && admins.some((a) => freeEmails.includes(a.email.toLowerCase()));
    return {
      id: c.id,
      name: c.name,
      createdAt: c.createdAt,
      admins,
      members: c.members.length,
      staff: c.members.filter((m) => m.role === "EMPLOYEE").length,
      entries: c._count.journalEntries,
      phase: envFree ? "free" : state.phase,
      plan: state.plan,
      trialEndsAt: trialEnd(c),
      daysLeft: state.daysLeft,
      currentPeriodEnd: c.currentPeriodEnd,
      cancelAtPeriodEnd: c.cancelAtPeriodEnd,
      billingFree: !!c.billingFree,
      stripeCustomerId: c.stripeCustomerId,
      lastSeen: lastSeen.get(c.id) ?? null,
    };
  });
}

export type OperatorCompany = Awaited<ReturnType<typeof listCompanies>>[number];

// 数字のまとめ: 会社の数・契約の内訳・月の売上の見込み(契約中の会社 × 月額)
export function summarize(companies: OperatorCompany[], now = new Date()) {
  const count = (phase: string) => companies.filter((c) => c.phase === phase).length;
  const p = plans();
  const paying = companies.filter((c) => c.phase === "active" || c.phase === "past_due");
  const mrr = paying.reduce((s, c) => s + (c.plan ? p[c.plan].price : 0), 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return {
    total: companies.length,
    trial: count("trial"),
    active: count("active"),
    pastDue: count("past_due"),
    expired: count("expired"),
    free: count("free"),
    light: paying.filter((c) => c.plan === "LIGHT").length,
    standard: paying.filter((c) => c.plan === "STANDARD").length,
    mrr,
    newThisMonth: companies.filter((c) => c.createdAt >= monthStart).length,
    endingSoon: companies.filter((c) => c.phase === "trial" && c.daysLeft <= 7).length,
    billingEnabled: billingEnabled(),
  };
}

// 無料期間を延ばす(今日か今の終わりの遅いほうから N 日)、無料にする・戻す
export async function updateCompanyBilling(companyId: string, input: { extendDays?: unknown; billingFree?: unknown }) {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, ...BILLING_SELECT } });
  if (!company) throw new UserError("会社が見つかりません");
  if (input.extendDays !== undefined) {
    const days = Number(input.extendDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new UserError("延ばす日数は1〜365日で入力してください");
    const base = Math.max(Date.now(), trialEnd(company).getTime());
    await prisma.company.update({ where: { id: companyId }, data: { trialEndsAt: new Date(base + days * 86_400_000) } });
    return { name: company.name, detail: `無料期間を${days}日延長` };
  }
  if (typeof input.billingFree === "boolean") {
    await prisma.company.update({ where: { id: companyId }, data: { billingFree: input.billingFree } });
    return { name: company.name, detail: input.billingFree ? "無料に設定" : "無料を解除" };
  }
  throw new UserError("操作が正しくありません");
}

// 同じメッセージ・同じ画面のエラーをまとめて、新しい順に
export async function recentErrors(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.errorLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 1000 });
  const groups = new Map<string, { message: string; path: string | null; method: string | null; count: number; last: Date; first: Date; stack: string | null; digest: string | null }>();
  for (const r of rows) {
    const key = `${r.message}|${r.path ?? ""}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.first = r.createdAt;
    } else groups.set(key, { message: r.message, path: r.path, method: r.method, count: 1, last: r.createdAt, first: r.createdAt, stack: r.stack, digest: r.digest });
  }
  return { total: rows.length, last24h: rows.filter((r) => r.createdAt.getTime() > Date.now() - 86_400_000).length, groups: [...groups.values()].slice(0, 50) };
}
