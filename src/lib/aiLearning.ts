import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { normalizeText } from "@/lib/bank/rules";

// AIが人の修正から学ぶ。人がAIの勘定科目を直すたびに記録し、
// 同じ取引先(経費・受け取った請求書)または同じ摘要(銀行・カード明細)で、続けて同じ科目に LEARN_AFTER 回直されたら覚える。
// ・取引先 → その取引先の既定科目にする(次からAIの推測より優先される)
// ・明細の摘要 → 銀行明細のルールを作る(自動では記帳せず、科目の候補として出す)

export const LEARN_AFTER = 2;
const LEARNED_MEMO = "AIが修正から覚えました";
const DAY = 86_400_000;

export type CorrectionKind = "EXPENSE" | "INVOICE" | "BANK";

// 摘要から数字・記号を除いて、照合に使うキーワードにする(日付・金額・番号が入っていても同じ相手として扱う)
export function bankKeyword(description: string) {
  return normalizeText(description)
    .replace(/[0-9０-９]+/g, " ")
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
}

export async function recordCorrection(
  companyId: string,
  input: { kind: CorrectionKind; key: string; label: string; fromCode: string | null; toCode: string; amount: number; direction?: "IN" | "OUT" },
) {
  if (!input.key || input.fromCode === input.toCode) return null;
  const correction = await prisma.aiCorrection.create({
    data: { companyId, kind: input.kind, key: input.key, label: input.label.slice(0, 100), fromCode: input.fromCode, toCode: input.toCode, amount: input.amount },
  });
  // 直近の修正が続けて同じ科目なら覚える
  const recent = await prisma.aiCorrection.findMany({ where: { companyId, kind: input.kind, key: input.key, forgotten: false }, orderBy: { createdAt: "desc" }, take: LEARN_AFTER });
  if (recent.length < LEARN_AFTER || recent.some((r) => r.toCode !== input.toCode)) return { correction, learned: null };
  if (recent.some((r) => r.learned && r.id !== correction.id)) return { correction, learned: null };

  const account = await prisma.account.findUnique({ where: { companyId_code: { companyId, code: input.toCode } }, select: { id: true, code: true, name: true } });
  if (!account) return { correction, learned: null };

  if (input.kind === "BANK") {
    const existing = await prisma.bankRule.findFirst({ where: { companyId, keyword: input.key, active: true } });
    if (existing && existing.accountCode === account.code) return { correction, learned: null };
    const rule = existing
      ? await prisma.bankRule.update({ where: { id: existing.id }, data: { accountCode: account.code, memo: LEARNED_MEMO } })
      : await prisma.bankRule.create({
          data: {
            companyId,
            keyword: input.key,
            direction: input.direction ?? "OUT",
            accountCode: account.code,
            autoPost: false,
            memo: LEARNED_MEMO,
            sortOrder: ((await prisma.bankRule.findFirst({ where: { companyId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } }))?.sortOrder ?? 0) + 1,
          },
        });
    await prisma.aiCorrection.update({ where: { id: correction.id }, data: { learned: "BANK_RULE", ruleId: rule.id } });
    return { correction, learned: { type: "BANK_RULE" as const, account } };
  }

  const vendor = await prisma.vendor.findFirst({ where: { id: input.key, companyId }, select: { id: true, defaultExpenseAccountId: true } });
  if (!vendor || vendor.defaultExpenseAccountId === account.id) return { correction, learned: null };
  await prisma.vendor.update({ where: { id: vendor.id }, data: { defaultExpenseAccountId: account.id } });
  await prisma.aiCorrection.update({ where: { id: correction.id }, data: { learned: "VENDOR_DEFAULT" } });
  return { correction, learned: { type: "VENDOR_DEFAULT" as const, account } };
}

// 覚えたことを忘れる(取引先の既定科目を外す / 作ったルールを消す)
export async function forgetLearning(companyId: string, id: string) {
  const c = await prisma.aiCorrection.findFirst({ where: { id, companyId, learned: { not: null }, forgotten: false } });
  if (!c) throw new UserError("覚えたことが見つかりません");
  if (c.learned === "BANK_RULE" && c.ruleId) {
    await prisma.bankRule.deleteMany({ where: { id: c.ruleId, companyId, memo: LEARNED_MEMO } });
  } else if (c.learned === "VENDOR_DEFAULT") {
    const account = await prisma.account.findUnique({ where: { companyId_code: { companyId, code: c.toCode } }, select: { id: true } });
    if (account) await prisma.vendor.updateMany({ where: { id: c.key, companyId, defaultExpenseAccountId: account.id }, data: { defaultExpenseAccountId: null } });
  }
  // この相手の修正の記録をまとめて「忘れた」にして、また2回直されたら覚え直す
  await prisma.aiCorrection.updateMany({ where: { companyId, kind: c.kind, key: c.key }, data: { forgotten: true } });
  return c;
}

export async function getLearningOverview(companyId: string, now = new Date()) {
  const since = new Date(now.getTime() - 90 * DAY);
  const [corrections, extractions, accounts, ruleHits] = await Promise.all([
    prisma.aiCorrection.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 300 }),
    prisma.aiExtraction.groupBy({ by: ["status"], where: { companyId, createdAt: { gte: since } }, _count: true }),
    prisma.account.findMany({ where: { companyId }, select: { code: true, name: true } }),
    prisma.bankRule.findMany({ where: { companyId, memo: LEARNED_MEMO }, select: { id: true, hits: true, lastUsedAt: true } }),
  ]);
  const name = new Map(accounts.map((a) => [a.code, a.name]));
  const hits = new Map(ruleHits.map((r) => [r.id, r]));
  const count = (s: string) => extractions.find((e) => e.status === s)?._count ?? 0;
  const autoApplied = count("AUTO_APPLIED");
  const corrected = count("CORRECTED");
  const learned = corrections
    .filter((c) => c.learned && !c.forgotten)
    .map((c) => ({
      id: c.id,
      kind: c.kind,
      label: c.kind === "BANK" ? c.key : c.label,
      account: `${c.toCode} ${name.get(c.toCode) ?? ""}`.trim(),
      learned: c.learned!,
      learnedAt: c.createdAt,
      hits: c.ruleId ? (hits.get(c.ruleId)?.hits ?? 0) : null,
    }));
  // まだ覚えていない相手(あと何回で覚えるか)
  const pendingMap = new Map<string, { kind: string; label: string; toCode: string; times: number; last: Date }>();
  for (const c of corrections) {
    if (c.forgotten) continue;
    const k = `${c.kind}|${c.key}`;
    if (learned.some((l) => corrections.find((x) => x.id === l.id && `${x.kind}|${x.key}` === k))) continue;
    const p = pendingMap.get(k);
    if (!p) pendingMap.set(k, { kind: c.kind, label: c.label, toCode: c.toCode, times: 1, last: c.createdAt });
    else if (p.toCode === c.toCode && p.times < LEARN_AFTER) p.times++;
  }
  const pending = [...pendingMap.values()]
    .filter((p) => p.times < LEARN_AFTER)
    .map((p) => ({ ...p, account: `${p.toCode} ${name.get(p.toCode) ?? ""}`.trim(), remaining: LEARN_AFTER - p.times }))
    .slice(0, 20);
  return {
    accuracy: autoApplied + corrected > 0 ? autoApplied / (autoApplied + corrected) : null,
    autoApplied,
    corrected,
    correctionsLast90: corrections.filter((c) => c.createdAt >= since).length,
    learned,
    pending,
    recent: corrections.slice(0, 15).map((c) => ({ id: c.id, kind: c.kind, label: c.label, from: c.fromCode ? `${c.fromCode} ${name.get(c.fromCode) ?? ""}`.trim() : "(候補なし)", to: `${c.toCode} ${name.get(c.toCode) ?? ""}`.trim(), learned: c.learned, createdAt: c.createdAt })),
  };
}
