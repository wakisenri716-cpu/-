import Anthropic from "@anthropic-ai/sdk";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getRequest, KIND_LABELS, type RequestKind } from "@/lib/approvals/service";
import { leaveBalance } from "@/lib/leave/service";
import { getCashBalance } from "@/lib/dashboard";
import { findDuplicates } from "@/lib/duplicates";

// 申請・承認のAIチェック: 稟議・申請や経費精算を承認する前に、決まったルールで確かめられること
// (重複・上限超え・領収書なし・有給の残り・初めての支払先など)を調べ、AIが内容を読んで
// 「承認前に確かめたい点」と「申請者に聞くとよいこと」をまとめる。最終的に決めるのは承認する人。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

export type CheckLevel = "warn" | "info" | "ok";
export type CheckPoint = { level: CheckLevel; text: string; source: "rule" | "ai" };
export type Verdict = "OK" | "CHECK" | "CAUTION";
export type TargetType = "REQUEST" | "EXPENSE";
type Actor = Pick<User, "id" | "name" | "role" | "companyId">;

const DAY = 86_400_000;
const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const rule = (level: CheckLevel, text: string): CheckPoint => ({ level, text, source: "rule" });

// ---- 稟議・申請 ----

async function requestFacts(user: Actor, id: string) {
  const req = await getRequest(user, id);
  if (!req) return null;
  const points: CheckPoint[] = [];
  const companyId = user.companyId;
  const since = new Date(req.createdAt.getTime() - 365 * DAY);
  const facts: Record<string, unknown> = {
    kind: KIND_LABELS[req.kind as RequestKind] ?? req.kind,
    title: req.title,
    body: req.body,
    amount: req.amount,
    payee: req.payee,
    requester: req.requesterName,
    requestedOn: jstDateKey(req.createdAt),
    status: req.status,
  };

  if (req.kind !== "LEAVE" && req.body.trim().length < 15) points.push(rule("warn", "内容・理由がほとんど書かれていません。目的と必要な理由を書いてもらうとよいです。"));

  if (req.kind === "PURCHASE") {
    if (!req.amount) points.push(rule("warn", "金額が入っていません。"));
    if (!req.payee) points.push(rule("info", "購入先・支払先が入っていません。"));
    const others = await prisma.approvalRequest.findMany({
      where: { companyId, kind: "PURCHASE", id: { not: req.id }, status: { in: ["PENDING", "APPROVED"] }, createdAt: { gte: since } },
      select: { number: true, title: true, amount: true, payee: true, status: true, createdAt: true, requesterId: true },
      orderBy: { createdAt: "desc" },
    });
    const samePayee = req.payee ? others.filter((o) => norm(o.payee) === norm(req.payee)) : [];
    const dup = others.find((o) => o.amount === req.amount && req.amount && (norm(o.payee) === norm(req.payee) || norm(o.title) === norm(req.title)) && Math.abs(o.createdAt.getTime() - req.createdAt.getTime()) < 90 * DAY);
    if (dup) points.push(rule("warn", `同じ金額の申請 ${dup.number}「${dup.title}」(${jstDateKey(dup.createdAt)}・${dup.status === "APPROVED" ? "承認済み" : "承認待ち"})があります。二重の申請でないか確かめてください。`));
    const past = samePayee.filter((o) => o.status === "APPROVED" && o.amount);
    if (req.payee && past.length === 0) points.push(rule("info", `「${req.payee}」への支払の申請はこの1年で初めてです。`));
    if (req.amount && past.length >= 2) {
      const avg = Math.round(past.reduce((s, o) => s + (o.amount ?? 0), 0) / past.length);
      if (req.amount > avg * 2) points.push(rule("warn", `「${req.payee}」へのこれまでの申請(平均 ${formatYen(avg)})の2倍を超える金額です。`));
    }
    if (req.payee) {
      const vendor = await prisma.vendor.findFirst({ where: { companyId, name: req.payee }, select: { registrationNumber: true } });
      if (vendor && !vendor.registrationNumber) points.push(rule("info", `「${req.payee}」はインボイスの登録番号が取引先に登録されていません。登録事業者でなければ消費税の控除が減ります。`));
      facts.vendorRegistered = !!vendor;
    }
    if (req.amount) {
      const cash = await getCashBalance(companyId);
      facts.cashBalance = cash;
      if (cash > 0 && req.amount > cash * 0.3) points.push(rule("warn", `現預金の残高(${formatYen(cash)})の3割を超える支払です。資金繰りに問題がないか確かめてください。`));
    }
    const mine = others.filter((o) => o.requesterId === req.requesterId && o.createdAt.getTime() > req.createdAt.getTime() - 30 * DAY);
    facts.requesterLast30Days = { count: mine.length, total: mine.reduce((s, o) => s + (o.amount ?? 0), 0) };
    facts.pastToSamePayee = past.slice(0, 5).map((o) => ({ number: o.number, title: o.title, amount: o.amount, on: jstDateKey(o.createdAt) }));
  }

  if (req.kind === "LEAVE" && req.staffId && req.leaveDate) {
    const days = req.leaveHalfDays === 1 ? 1 : 2;
    const balance = await leaveBalance(companyId, req.staffId);
    facts.leave = { date: jstDateKey(req.leaveDate), halfDays: days, balanceDays: balance / 2 };
    if (req.status === "PENDING" && balance < days) points.push(rule("warn", `有給の残りが ${balance / 2}日 しかなく、足りません。`));
    const range = { gte: req.leaveDate, lt: new Date(req.leaveDate.getTime() + DAY) };
    const [shift, sameDay] = await Promise.all([
      prisma.shift.count({ where: { companyId, staffId: req.staffId, date: range } }),
      prisma.approvalRequest.count({ where: { companyId, kind: "LEAVE", id: { not: req.id }, status: { in: ["PENDING", "APPROVED"] }, leaveDate: range } }),
    ]);
    if (shift) points.push(rule("info", "休む日にシフトが入っています。代わりの人がいるか確かめてください。"));
    if (sameDay) points.push(rule("info", `同じ日に、ほかに ${sameDay}人 が休みを申請しています。`));
    const lead = Math.round((req.leaveDate.getTime() - Date.parse(`${jstDateKey(req.createdAt)}T00:00:00Z`)) / DAY);
    if (lead < 0) points.push(rule("info", "休んだ日のあとに出された申請です(事後申請)。"));
    facts.leave = { ...(facts.leave as object), shiftOnThatDay: shift > 0, othersOffThatDay: sameDay, daysInAdvance: lead };
  }
  return { facts, points, companyId };
}

// ---- 経費精算 ----

async function expenseFacts(companyId: string, id: string) {
  const report = await prisma.expenseReport.findFirst({
    where: { id, companyId },
    include: {
      employee: { select: { id: true, name: true } },
      items: {
        include: { account: { select: { code: true, name: true } }, vendor: { select: { name: true, registrationNumber: true } } },
        orderBy: { expenseDate: "asc" },
      },
    },
  });
  if (!report) return null;
  const [company, dup] = await Promise.all([prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { expenseItemLimit: true } }), findDuplicates(companyId)]);
  const points: CheckPoint[] = [];
  const base = report.submittedAt ?? report.createdAt;
  const limit = company.expenseItemLimit;
  const ids = new Set(report.items.map((i) => i.id));
  for (const g of dup.groups) {
    const mine = g.items.filter((r) => ids.has(r.id));
    if (!mine.length || g.level === "LOW") continue;
    const other = g.items.find((r) => !ids.has(r.id) || r.id !== mine[0].id);
    points.push(rule("warn", `「${mine[0].label}」(${formatYen(mine[0].amount)})は二重計上かもしれません: ${g.reason}${other ? `(${other.who ? `${other.who}さんの` : ""}${other.label})` : ""}`));
  }
  const items = report.items.map((i) => {
    const date = jstDateKey(i.expenseDate);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const age = Math.round((base.getTime() - i.expenseDate.getTime()) / DAY);
    if (limit && i.amount > limit) points.push(rule("warn", `「${i.description}」${formatYen(i.amount)} は1件の上限 ${formatYen(limit)} を超えています。`));
    if (!i.receiptImageUrl && i.amount >= 30_000) points.push(rule("warn", `「${i.description}」${formatYen(i.amount)} に領収書の画像がありません(3万円以上)。`));
    else if (!i.receiptImageUrl && !/交通|電車|バス|タクシー|運賃|日当/.test(`${i.description}${i.account?.name ?? ""}`)) points.push(rule("info", `「${i.description}」に領収書の画像がありません。`));
    if (age > 60) points.push(rule("info", `「${i.description}」は ${age}日前(${date})の経費です。精算が遅れた理由を聞くとよいです。`));
    if (i.account?.name.includes("交際")) points.push(rule("info", `「${i.description}」は交際費です。相手先・人数・目的がわかるか確かめてください。`));
    return { date, weekday: "日月火水木金土"[dow], description: i.description, amount: i.amount, account: i.account?.name ?? null, vendor: i.vendor?.name ?? null, vendorInvoiceRegistered: i.vendor ? !!i.vendor.registrationNumber : null, hasReceipt: !!i.receiptImageUrl };
  });
  const weekend = items.filter((i) => i.weekday === "土" || i.weekday === "日");
  if (weekend.length) points.push(rule("info", `土日の経費が ${weekend.length}件 あります(${weekend.map((i) => `${i.date.slice(5)} ${i.description}`).slice(0, 3).join("、")})。仕事のための支払か確かめてください。`));
  const past = await prisma.expenseReport.findMany({
    where: { companyId, employeeId: report.employee.id, id: { not: report.id }, createdAt: { gte: new Date(base.getTime() - 180 * DAY) } },
    select: { items: { select: { amount: true } } },
  });
  const pastTotals = past.map((r) => r.items.reduce((s, i) => s + i.amount, 0)).filter((t) => t > 0);
  const total = report.items.reduce((s, i) => s + i.amount, 0);
  const avg = pastTotals.length ? Math.round(pastTotals.reduce((s, t) => s + t, 0) / pastTotals.length) : null;
  if (avg && pastTotals.length >= 2 && total > avg * 2) points.push(rule("info", `${report.employee.name}さんのこれまでの精算(平均 ${formatYen(avg)})の2倍を超える金額です。`));
  return {
    companyId,
    points,
    facts: { employee: report.employee.name, total, itemLimit: limit, submittedOn: jstDateKey(base), items, pastReportsAverage: avg, pastReportsCount: pastTotals.length },
  };
}

// ---- まとめ ----

export function verdictOf(points: CheckPoint[]): Verdict {
  const warns = points.filter((p) => p.level === "warn").length;
  return warns >= 2 ? "CAUTION" : warns === 1 || points.some((p) => p.level === "info") ? "CHECK" : "OK";
}

export function templateSummary(points: CheckPoint[]) {
  const warns = points.filter((p) => p.level === "warn");
  const infos = points.filter((p) => p.level === "info");
  if (!points.length) return { summary: "決まったルールで確かめられる範囲では、気になる点は見つかりませんでした。内容を読んで判断してください。", questions: [] as string[] };
  return {
    summary: warns.length ? `承認する前に確かめたい点が ${warns.length}件 あります(そのほか参考 ${infos.length}件)。` : `大きな問題は見つかりませんでしたが、参考にしたい点が ${infos.length}件 あります。`,
    questions: [] as string[],
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["OK", "CHECK", "CAUTION"], description: "OK=気になる点なし / CHECK=確かめたい点あり / CAUTION=承認前に必ず確かめるべき点あり" },
    summary: { type: "string", description: "承認する人への一言(80字以内)" },
    points: {
      type: "array",
      description: "ルールでの確認結果に加えて、内容を読んで気づいたこと(最大4つ。ルールの結果のくり返しは書かない)",
      items: {
        type: "object",
        properties: { level: { type: "string", enum: ["warn", "info", "ok"] }, text: { type: "string" } },
        required: ["level", "text"],
        additionalProperties: false,
      },
    },
    questions: { type: "array", items: { type: "string" }, description: "申請者に聞くとよいこと(最大3つ)" },
  },
  required: ["verdict", "summary", "points", "questions"],
  additionalProperties: false,
} as const;

async function claudeCheck(kindLabel: string, facts: Record<string, unknown>, rulePoints: CheckPoint[]) {
  const response = await new Anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: [
      {
        type: "text",
        text: [
          "あなたは会社の経理・総務で、申請を承認する人を手伝う確認係です。渡された申請の内容(JSON)と、決まったルールで確かめた結果を読み、承認する前に確かめたい点をまとめてください。",
          "見るところ: 目的・理由がはっきりしているか、金額が内容に見合っているか、内容と金額・勘定科目・日付がかみ合っているか、私的な支出に見えないか、分割して上限や承認ルートを避けていないか、ほかの申請と重なっていないか。",
          "ルールの結果をくり返さず、内容を読んで新しく気づいたことだけを points に書いてください。根拠のない疑いはかけず、申請者を責める書き方はしないでください。金額は「1,234円」の形で書いてください。",
          "承認するかどうかを決めるのは人です。あなたは判断の材料を出すだけにしてください。",
        ].join("\n"),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: `${kindLabel}の内容です。\n${JSON.stringify(facts)}\n\nルールで確かめた結果:\n${JSON.stringify(rulePoints.map((p) => ({ level: p.level, text: p.text })))}` }],
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  const raw = JSON.parse(text) as { verdict?: unknown; summary?: unknown; points?: unknown; questions?: unknown };
  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const levels: CheckLevel[] = ["warn", "info", "ok"];
  const points = (Array.isArray(raw.points) ? raw.points : [])
    .map((p: { level?: unknown; text?: unknown }) => ({ level: (levels.includes(p?.level as CheckLevel) ? p.level : "info") as CheckLevel, text: str(p?.text, 200), source: "ai" as const }))
    .filter((p) => p.text)
    .slice(0, 4);
  const verdicts: Verdict[] = ["OK", "CHECK", "CAUTION"];
  const summary = str(raw.summary, 160);
  if (!summary) return null;
  return {
    verdict: verdicts.includes(raw.verdict as Verdict) ? (raw.verdict as Verdict) : null,
    summary,
    points,
    questions: (Array.isArray(raw.questions) ? raw.questions : []).map((q) => str(q, 160)).filter(Boolean).slice(0, 3),
  };
}

const RANK: Record<Verdict, number> = { OK: 0, CHECK: 1, CAUTION: 2 };

export async function getCheck(targetType: TargetType, targetId: string, companyId: string) {
  return prisma.approvalCheck.findFirst({ where: { targetType, targetId, companyId } });
}

// AIチェックを作る(作り直す)。ifMissing なら、もうあるときはそれを返す。
export async function runApprovalCheck(user: Actor, targetType: TargetType, targetId: string, ifMissing = false) {
  // 稟議は承認できる人(と管理者・経理担当)だけ、経費精算は管理者・経理担当だけ
  if (user.role === "EMPLOYEE") {
    if (targetType === "EXPENSE") throw new UserError("経費精算のAIチェックは管理者・経理担当だけが使えます");
    const req = await getRequest(user, targetId);
    if (!req?.canDecide) throw new UserError("この申請を承認する人だけがAIチェックを使えます");
  }
  if (ifMissing) {
    const existing = await getCheck(targetType, targetId, user.companyId);
    if (existing) return { check: existing, created: false };
  }
  const gathered = targetType === "REQUEST" ? await requestFacts(user, targetId) : await expenseFacts(user.companyId, targetId);
  if (!gathered) throw new UserError("対象が見つかりません");
  const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
    throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  }
  const rulePoints = gathered.points;
  const ruleVerdict = verdictOf(rulePoints);
  let result = { verdict: ruleVerdict, ...templateSummary(rulePoints), points: rulePoints };
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const ai = await claudeCheck(targetType === "REQUEST" ? "稟議・申請" : "経費精算", gathered.facts, rulePoints);
      if (ai) {
        // ルールで見つけた点は必ず残し、AIの判定がルールより軽くならないようにする
        const points = [...rulePoints, ...ai.points];
        const floor = verdictOf(points);
        const verdict = ai.verdict && RANK[ai.verdict] > RANK[floor] ? ai.verdict : floor;
        result = { verdict, summary: ai.summary, questions: ai.questions, points };
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `承認前のAIチェック ${targetType} ${targetId}`, tools: [], mode: `check-${mode}` } });
  const data = { companyId: user.companyId, verdict: result.verdict, summary: result.summary, points: result.points, questions: result.questions, mode };
  const check = await prisma.approvalCheck.upsert({
    where: { targetType_targetId: { targetType, targetId } },
    create: { targetType, targetId, ...data },
    update: { ...data, createdAt: new Date() },
  });
  return { check, created: true };
}
