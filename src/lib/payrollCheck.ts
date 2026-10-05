import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { getPayrollSheet } from "@/lib/payroll/service";

// 給料を計上する前のチェック: 決まったルールで確かめられること(退勤の打刻忘れ・先月から大きく変わった支給額・
// 残業の多さ・手取りがマイナス・源泉所得税が0円・時給の低さ・通勤手当の非課税枠・先月いて今月いない人)を探し、
// AIが「計上してよいか」と確かめる順番をまとめる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type PayrollPoint = { level: "warn" | "info"; staff: string | null; text: string };

const shift = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export async function runPayrollCheck(companyId: string, month: string) {
  if (!MONTH.test(month)) throw new UserError("月を正しく指定してください");
  const range = { gte: new Date(`${month}-01T00:00:00Z`), lt: new Date(`${shift(month, 1)}-01T00:00:00Z`) };
  const [sheet, prev, openRecords] = await Promise.all([
    getPayrollSheet(companyId, month),
    getPayrollSheet(companyId, shift(month, -1)),
    prisma.timeRecord.findMany({ where: { companyId, date: range, clockOut: null }, select: { date: true, staff: { select: { name: true } } } }),
  ]);
  const points: PayrollPoint[] = [];
  const byStaff = new Map<string, string[]>();
  for (const r of openRecords) byStaff.set(r.staff.name, [...(byStaff.get(r.staff.name) ?? []), jstDateKey(r.date).slice(5)]);
  for (const [name, days] of byStaff) points.push({ level: "warn", staff: name, text: `退勤の打刻がない日が ${days.length}日 あります(${days.slice(0, 3).join("、")}${days.length > 3 ? "など" : ""})。勤怠一覧で直してから計上してください。` });

  const prevBy = new Map(prev.rows.map((r) => [r.staffId, r]));
  for (const r of sheet.rows) {
    const p = prevBy.get(r.staffId);
    if (p && p.gross > 0) {
      const diff = r.gross - p.gross;
      if (Math.abs(diff) >= 30_000 && Math.abs(diff) / p.gross >= 0.3) points.push({ level: "info", staff: r.name, text: `総支給が先月より ${diff > 0 ? "+" : "−"}${formatYen(Math.abs(diff))}(${formatYen(p.gross)} → ${formatYen(r.gross)})と大きく変わりました。勤務日数・時間・手当を確かめてください。` });
    }
    if ((r.overtimeMinutes ?? 0) > 45 * 60) points.push({ level: "warn", staff: r.name, text: `時間外労働が ${Math.round((r.overtimeMinutes ?? 0) / 60)}時間 です。36協定の原則の上限(月45時間)を超えています。` });
    if (r.netPay < 0) points.push({ level: "warn", staff: r.name, text: `差引支給額がマイナス(${formatYen(r.netPay)})です。控除額を確かめてください。` });
    if (r.taxColumn === "KOU" && r.gross - r.commute >= 88_000 && r.incomeTax === 0 && !r.incomeTaxOverridden) points.push({ level: "info", staff: r.name, text: `課税される支給が ${formatYen(r.gross - r.commute)} ありますが、源泉所得税が0円です。扶養人数などを確かめてください。` });
    if (r.incomeTaxNeedsInput) points.push({ level: "warn", staff: r.name, text: "源泉所得税を手で入れる必要があります(乙欄など)。" });
    if (r.hourlyWage > 0 && r.hourlyWage < 1_050) points.push({ level: "info", staff: r.name, text: `時給が ${formatYen(r.hourlyWage)} です。都道府県の最低賃金を下回っていないか確かめてください。` });
    if (r.commute > 150_000) points.push({ level: "info", staff: r.name, text: `通勤手当が ${formatYen(r.commute)} です。非課税の上限(月15万円)を超える分は課税になります。` });
  }
  const now = new Set(sheet.rows.map((r) => r.staffId));
  for (const p of prev.rows) if (!now.has(p.staffId) && p.gross > 0) points.push({ level: "info", staff: p.name, text: "先月は給料がありましたが、今月はありません。退職・休職でなければ、シフトや勤怠の入力漏れかもしれません。" });

  points.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));
  return { month, posted: sheet.posted, staffCount: sheet.rows.length, gross: sheet.totals.gross, prevGross: prev.totals.gross, points };
}

const SCHEMA = {
  type: "object",
  properties: {
    ready: { type: "boolean", description: "このまま計上してよさそうなら true" },
    summary: { type: "string", description: "今月の給料の見立て(80字以内)" },
    steps: { type: "array", items: { type: "string" }, description: "計上する前に確かめる順番(最大5つ、短く)" },
  },
  required: ["ready", "summary", "steps"],
  additionalProperties: false,
} as const;

export async function reviewPayroll(user: { id: string; name: string; companyId: string }, month: string) {
  const companyId = user.companyId;
  const r = await runPayrollCheck(companyId, month);
  const warns = r.points.filter((p) => p.level === "warn").length;
  let result = {
    ready: warns === 0,
    summary: warns ? `計上する前に直したいところが ${warns}件 あります。` : r.points.length ? "大きな問題はありませんが、確かめたいところがあります。" : "決まったルールで見る限り、問題は見つかりませんでした。",
    steps: r.points.slice(0, 5).map((p) => `${p.staff ? `${p.staff}: ` : ""}${p.text}`),
  };
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY && r.points.length) {
    const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await new Anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の給与計算を手伝う担当者です。決まったルールで見つかった確かめたいところ(JSON)を読み、今月の給料をこのまま計上してよいかを見立て、計上前に確かめる順番を書いてください。",
              "打刻漏れ・手取りのマイナス・36協定の上限超えのように、計上額や法令に関わるものを先にしてください。金額は「1,234円」の形で書き、データにないことを推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify({ month: r.month, staffCount: r.staffCount, gross: r.gross, prevGross: r.prevGross, points: r.points }) }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        const raw = JSON.parse(text) as { ready?: unknown; summary?: unknown; steps?: unknown };
        const summary = String(raw.summary ?? "").trim().slice(0, 160);
        if (summary) {
          // ルールで直したいところがあれば、AIが計上してよいと言っても「計上してよさそう」にはしない
          result = { ready: warns === 0 && raw.ready === true, summary, steps: (Array.isArray(raw.steps) ? raw.steps : []).map((s) => String(s).trim().slice(0, 160)).filter(Boolean).slice(0, 5) };
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: `給料の計上前チェック ${month}`, tools: [], mode: `payroll-${mode}` } });
  }
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: "PAYROLL_CHECK", key: month } },
    create: { companyId, kind: "PAYROLL_CHECK", key: month, data: result, mode, createdBy: user.name },
    update: { data: result, mode, createdBy: user.name, createdAt: new Date() },
  });
}

export async function getPayrollReview(companyId: string, month: string) {
  return prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: "PAYROLL_CHECK", key: month } } });
}
