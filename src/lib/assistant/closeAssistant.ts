import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getMonthlyClose, parseMonth } from "@/lib/monthlyClose";
import { listRecurring, postRecurring } from "@/lib/accounting/recurring";
import { listAllocations, postMonth } from "@/lib/accounting/allocations";
import { getFixedAssetsWithSummary, postDepreciationForAll } from "@/lib/accounting/fixedAssets";
import { confirmBankTransaction } from "@/lib/bank/process";
import { findAnomalies } from "@/lib/anomalies";

// AIの月次決算アシスト:
// ・まとめて片付けられる作業(定期取引・期間按分・減価償却・AIの確信度が高い明細の確定)をボタン1つで実行する
// ・前の3か月は毎月あったのに、この月にはない費用(家賃・通信費など)を「計上漏れかもしれない」として出す
// ・残っている項目・計上漏れ・いつもと違う動きを見て、AIが「締めてよいか」を見立てる

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const BANK_CONFIDENCE = 0.9;

export type TaskKey = "recurring" | "allocations" | "depreciation" | "bank";

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const rangeOf = (month: string) => ({ gte: new Date(`${month}-01T00:00:00Z`), lt: new Date(`${addMonths(month, 1)}-01T00:00:00Z`) });

async function bankTargets(companyId: string, month: string) {
  const rows = await prisma.bankTransaction.findMany({
    where: { companyId, status: "PENDING", date: rangeOf(month), suggestedAccountCode: { not: null }, confidence: { gte: BANK_CONFIDENCE } },
    select: { id: true, suggestedAccountCode: true, withdrawal: true, deposit: true },
  });
  return rows;
}

// まとめて片付けられる作業(この月まで)
export async function getCloseTasks(companyId: string, month: string) {
  const [recurring, allocations, assets, bank] = await Promise.all([listRecurring(companyId), listAllocations(companyId), getFixedAssetsWithSummary(companyId), bankTargets(companyId, month)]);
  const rec = recurring.flatMap((e) => e.due.filter((m) => m <= month).map(() => e.amount));
  const alloc = allocations.rows.flatMap((r) => r.due.filter((m) => m <= month).map((m) => r.schedule.find((s) => s.month === m)?.amount ?? 0));
  const dep = assets.filter((a) => !a.disposedAt && !a.fullyDepreciated && a.acquisitionDate.toISOString().slice(0, 7) <= month && !a.depreciationEntries.some((e) => e.period === month));
  const sum = (list: number[]) => list.reduce((s, n) => s + n, 0);
  return [
    { key: "recurring" as const, label: "家賃など毎月の取引の記帳", count: rec.length, amount: sum(rec), href: "/recurring" },
    { key: "allocations" as const, label: "前払費用・前受金の今月分の計上", count: alloc.length, amount: sum(alloc), href: "/allocations" },
    { key: "depreciation" as const, label: `${Number(month.slice(5))}月分の減価償却`, count: dep.length, amount: sum(dep.map((a) => a.monthlyDepreciation)), href: "/assets" },
    { key: "bank" as const, label: "AIの確信度が高い銀行・カード明細の確定", count: bank.length, amount: sum(bank.map((b) => b.withdrawal || b.deposit)), href: "/bank" },
  ];
}

export async function runCloseTask(companyId: string, monthValue: unknown, key: unknown) {
  const month = parseMonth(monthValue);
  if (month > jstDateKey(new Date()).slice(0, 7)) throw new UserError("先の月は実行できません");
  const errors: string[] = [];
  let done = 0;
  const attempt = async (label: string, f: () => Promise<unknown>) => {
    try {
      await f();
      done++;
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : "失敗しました"}`);
      return false;
    }
    return true;
  };
  if (key === "recurring") {
    for (const e of await listRecurring(companyId)) for (const m of e.due.filter((m) => m <= month)) await attempt(`${e.name} ${m}`, () => postRecurring(companyId, e.id, m));
  } else if (key === "allocations") {
    for (const r of (await listAllocations(companyId)).rows) {
      // 前の月から順に。途中で失敗したら、その按分の残りはやめる
      for (const m of r.due.filter((m) => m <= month)) if (!(await attempt(`${r.name} ${m}`, () => postMonth(companyId, r.id, m)))) break;
    }
  } else if (key === "depreciation") {
    const r = await postDepreciationForAll(companyId, month);
    done = r.posted;
    errors.push(...r.errors);
  } else if (key === "bank") {
    const accounts = new Map((await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.code, a.id]));
    for (const b of await bankTargets(companyId, month)) {
      const accountId = accounts.get(b.suggestedAccountCode!);
      if (accountId) await attempt("明細", () => confirmBankTransaction(companyId, b.id, accountId));
    }
  } else throw new UserError("作業の種類が正しくありません");
  return { month, done, errors: errors.slice(0, 10) };
}

// 前の3か月は毎月あった費用の科目が、この月にはない(計上漏れかもしれない)
export async function findMissingEntries(companyId: string, month: string) {
  const months = [addMonths(month, -3), addMonths(month, -2), addMonths(month, -1)];
  const lines = await prisma.journalLine.findMany({
    where: {
      debit: { gt: 0 },
      account: { companyId, category: "EXPENSE" },
      journalEntry: { companyId, status: { in: [...POSTED] }, date: { gte: new Date(`${months[0]}-01T00:00:00Z`), lt: rangeOf(month).lt } },
    },
    select: { debit: true, account: { select: { id: true, code: true, name: true } }, journalEntry: { select: { date: true, description: true } } },
  });
  const byAccount = new Map<string, { id: string; name: string; perMonth: Map<string, number>; last: { date: string; description: string } | null }>();
  for (const l of lines) {
    const m = l.journalEntry.date.toISOString().slice(0, 7);
    const a = byAccount.get(l.account.code) ?? { id: l.account.id, name: l.account.name, perMonth: new Map(), last: null };
    a.perMonth.set(m, (a.perMonth.get(m) ?? 0) + l.debit);
    if (m !== month && (!a.last || a.last.date < jstDateKey(l.journalEntry.date))) a.last = { date: jstDateKey(l.journalEntry.date), description: l.journalEntry.description };
    byAccount.set(l.account.code, a);
  }
  return [...byAccount.entries()]
    .filter(([, a]) => !a.name.includes("減価償却") && months.every((m) => (a.perMonth.get(m) ?? 0) > 0) && !(a.perMonth.get(month) ?? 0))
    .map(([code, a]) => {
      const amounts = months.map((m) => a.perMonth.get(m)!).sort((x, y) => x - y);
      return { code, account: a.name, href: `/ledger?accountId=${a.id}`, typical: amounts[1], last: a.last };
    })
    .sort((x, y) => y.typical - x.typical);
}

const SCHEMA = {
  type: "object",
  properties: {
    ready: { type: "boolean", description: "このまま帳簿を締めてよさそうなら true" },
    summary: { type: "string", description: "この月の締めの見立て(80字以内)" },
    points: {
      type: "array",
      description: "締める前にやること・確かめること(重要な順に最大6つ)",
      items: {
        type: "object",
        properties: { level: { type: "string", enum: ["warn", "info", "ok"] }, text: { type: "string" }, href: { type: "string" } },
        required: ["level", "text", "href"],
        additionalProperties: false,
      },
    },
  },
  required: ["ready", "summary", "points"],
  additionalProperties: false,
} as const;

type Point = { level: "warn" | "info" | "ok"; text: string; href: string };

export async function reviewClose(user: { id: string; name: string; companyId: string }, monthValue: unknown) {
  const companyId = user.companyId;
  const month = parseMonth(monthValue);
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const [close, tasks, missing, anomalies] = await Promise.all([getMonthlyClose(companyId, month), getCloseTasks(companyId, month), findMissingEntries(companyId, month), findAnomalies(companyId, month)]);
  const left = close.items.filter((i) => !i.done && i.key !== "closed");
  // 決まったルールでの見立て
  const points: Point[] = [
    ...tasks.filter((t) => t.count > 0).map((t) => ({ level: "warn" as const, text: `${t.label}が ${t.count}件 残っています(「まとめて実行」で片付けられます)。`, href: "/monthly-close" })),
    ...missing.slice(0, 4).map((m) => ({ level: "warn" as const, text: `${m.account}(いつもは月 ${formatYen(m.typical)} ほど)がこの月はまだ記帳されていません。`, href: m.href })),
    ...left
      .filter((i) => i.kind === "auto" && !tasks.some((t) => t.key === i.key && t.count > 0))
      .map((i) => ({ level: "warn" as const, text: `まだ済んでいません: ${i.label}${i.detail ? `(${i.detail})` : ""}`, href: i.href ?? "/monthly-close" })),
    ...(() => {
      const manual = left.filter((i) => i.kind === "manual");
      return manual.length ? [{ level: "info" as const, text: `人が確かめる項目が ${manual.length}件 残っています(${manual.slice(0, 2).map((i) => `「${i.label}」`).join("")}${manual.length > 2 ? "など" : ""})。`, href: "/monthly-close" }] : [];
    })(),
    ...anomalies.anomalies.slice(0, 3).map((a) => ({ level: "info" as const, text: `${a.title}: ${a.detail}`, href: "/anomalies" })),
  ];
  const ready = !points.some((p) => p.level === "warn");
  let result = { ready, summary: ready ? "残っている作業は見当たりません。試算表を見て、問題がなければ帳簿を締めましょう。" : `締める前に片付けたいことが ${points.filter((p) => p.level === "warn").length}件 あります。`, points: points.slice(0, 8) };
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const facts = {
        month,
        checklist: close.items.map((i) => ({ label: i.label, done: i.done, detail: i.detail ?? null, href: i.href ?? null })),
        batchTasks: tasks,
        possiblyMissing: missing.slice(0, 8),
        anomalies: anomalies.anomalies.slice(0, 5).map((a) => ({ title: a.title, detail: a.detail })),
      };
      const response = await new Anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の月次決算を手伝う経理の担当者です。渡された状況(JSON)だけをもとに、その月の帳簿を締めてよいかを見立て、締める前にやること・確かめることを重要な順に書いてください。",
              "batchTasks は画面のボタンでまとめて実行できる作業です(href は /monthly-close)。possiblyMissing は前の3か月は毎月あったのにこの月にない費用で、計上漏れか、本当になくなったのかを確かめるよう書いてください(href は possiblyMissing の href)。",
              "href は checklist の href・possiblyMissing の href・/monthly-close・/anomalies・/closing のどれかだけを使ってください。金額は「1,234円」の形で書き、数字にないことを推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify(facts) }],
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const raw = JSON.parse(text) as { ready?: unknown; summary?: unknown; points?: unknown };
        const allowed = new Set(["/monthly-close", "/anomalies", "/closing", ...missing.map((m) => m.href), ...close.items.flatMap((i) => (i.href ? [i.href] : []))]);
        const levels = ["warn", "info", "ok"];
        const aiPoints = (Array.isArray(raw.points) ? raw.points : [])
          .map((p: { level?: unknown; text?: unknown; href?: unknown }) => {
            const href = String(p?.href ?? "");
            return { level: (levels.includes(String(p?.level)) ? p.level : "info") as Point["level"], text: String(p?.text ?? "").trim().slice(0, 200), href: allowed.has(href) ? href : "/monthly-close" };
          })
          .filter((p) => p.text)
          .slice(0, 6);
        const summary = String(raw.summary ?? "").trim().slice(0, 160);
        // ルールで「残りあり」なら、AIが「締めてよい」と言っても締めてよいことにはしない
        if (summary) {
          result = { ready: ready && raw.ready === true, summary, points: aiPoints.length ? aiPoints : result.points };
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
  }
  await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: `月次決算の見立て ${month}`, tools: [], mode: `close-${mode}` } });
  return prisma.monthlyCloseReview.upsert({
    where: { companyId_month: { companyId, month } },
    create: { companyId, month, ...result, mode, createdBy: user.name },
    update: { ...result, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getCloseReview(companyId: string, month: string) {
  return prisma.monthlyCloseReview.findUnique({ where: { companyId_month: { companyId, month } } });
}
