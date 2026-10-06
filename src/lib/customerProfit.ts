import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// 顧客別の採算: 直近12か月に発行した請求書の売上(税抜)から、その顧客の案件(案件の顧客名が同じもの)に付いた
// 原価・経費の仕訳と、日報の作業時間 × 時間単価を引いて、顧客ごとの粗利・粗利率・1時間あたりの粗利を出す。
// 入金の早さ(期日から何日遅れて入ったか)と、期日を過ぎた未入金も並べる。
// AIが使えるときは、顧客ごとに次の一手(単価の見直し・作業範囲の見直し・支払い条件・大事にする)を書く。何も保存しない。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const POSTED = ["AUTO_POSTED", "POSTED_MANUALLY"] as const;
const DAY = 86_400_000;
const yen = (n: number) => (n < 0 ? `−${formatYen(-n)}` : formatYen(n));

export const CUSTOMER_ACTIONS = { RAISE_PRICE: "単価を見直す", SCOPE: "作業の範囲を見直す", TERMS: "支払い条件を相談", NURTURE: "大事にする・取引を増やす", KEEP: "このまま" } as const;
export type CustomerAction = keyof typeof CUSTOMER_ACTIONS;

export type CustomerProfitRow = {
  key: string;
  customerId: string | null;
  name: string;
  invoices: number;
  revenue: number;
  share: number;
  cost: number;
  laborCost: number;
  hours: number;
  gross: number;
  margin: number | null;
  grossPerHour: number | null;
  avgLateDays: number | null;
  overdue: number;
  flags: ("LOSS" | "LOW_MARGIN" | "HOURS_HEAVY" | "LATE")[];
  suggestion: CustomerAction | null;
  aiNote: string | null;
};

export async function getCustomerProfit(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const to = new Date(`${today}T00:00:00Z`);
  const from = new Date(to.getTime() - 365 * DAY);
  const until = new Date(to.getTime() + DAY);
  const [customers, invoices, projects] = await Promise.all([
    prisma.customer.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.invoice.findMany({
      where: { companyId, direction: "ISSUED", status: { notIn: ["DRAFT", "CANCELLED"] }, issueDate: { gte: from, lt: until } },
      select: { customerId: true, customer: { select: { name: true } }, subtotalAmount: true, totalAmount: true, issueDate: true, dueDate: true, payments: { select: { amount: true, paymentDate: true } } },
    }),
    prisma.project.findMany({ where: { companyId, customerName: { not: null } }, select: { id: true, customerName: true } }),
  ]);
  const projectIds = projects.map((p) => p.id);
  const [costLines, logs] = await Promise.all([
    projectIds.length
      ? prisma.journalLine.findMany({
          where: { account: { category: "EXPENSE" }, journalEntry: { companyId, status: { in: [...POSTED] }, projectId: { in: projectIds }, date: { gte: from, lt: until } } },
          select: { debit: true, credit: true, journalEntry: { select: { projectId: true } } },
        })
      : Promise.resolve([]),
    projectIds.length ? prisma.workLog.findMany({ where: { companyId, projectId: { in: projectIds }, date: { gte: from, lt: until } }, select: { projectId: true, minutes: true, hourlyCost: true } }) : Promise.resolve([]),
  ]);

  const norm = (s: string) => s.normalize("NFKC").replace(/\s+/g, "").trim();
  const byName = new Map(customers.map((c) => [norm(c.name), c]));
  const rows = new Map<string, Omit<CustomerProfitRow, "share" | "gross" | "margin" | "grossPerHour" | "avgLateDays" | "flags" | "suggestion" | "aiNote"> & { lateDays: number[] }>();
  const rowFor = (name: string, customerId: string | null) => {
    const key = customerId ?? `name:${norm(name)}`;
    const r = rows.get(key) ?? { key, customerId, name, invoices: 0, revenue: 0, cost: 0, laborCost: 0, hours: 0, overdue: 0, lateDays: [] };
    rows.set(key, r);
    return r;
  };
  for (const inv of invoices) {
    const name = inv.customer?.name ?? "(顧客なし)";
    const r = rowFor(name, inv.customerId);
    r.invoices += 1;
    r.revenue += inv.subtotalAmount;
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    const due = inv.dueDate ? jstDateKey(inv.dueDate) : null;
    if (paid >= inv.totalAmount && inv.payments.length && due) {
      const last = Math.max(...inv.payments.map((p) => p.paymentDate.getTime()));
      r.lateDays.push(Math.round((last - Date.parse(`${due}T00:00:00Z`)) / DAY));
    } else if (due && due < today) r.overdue += inv.totalAmount - paid;
  }
  // 案件の顧客名から顧客を決める(顧客の登録がなければ名前でまとめる)
  const customerOfProject = new Map(projects.map((p) => [p.id, byName.get(norm(p.customerName!)) ?? null]));
  const projectName = new Map(projects.map((p) => [p.id, p.customerName!]));
  for (const l of costLines) {
    const pid = l.journalEntry.projectId!;
    const c = customerOfProject.get(pid);
    rowFor(c?.name ?? projectName.get(pid)!, c?.id ?? null).cost += l.debit - l.credit;
  }
  for (const w of logs) {
    const pid = w.projectId!;
    const c = customerOfProject.get(pid);
    const r = rowFor(c?.name ?? projectName.get(pid)!, c?.id ?? null);
    r.laborCost += Math.round((w.minutes / 60) * w.hourlyCost);
    r.hours += w.minutes / 60;
  }

  const totalRevenue = [...rows.values()].reduce((s, r) => s + r.revenue, 0);
  const list: CustomerProfitRow[] = [...rows.values()].map(({ lateDays, ...r }) => {
    const gross = r.revenue - r.cost - r.laborCost;
    const hours = Math.round(r.hours * 10) / 10;
    return {
      ...r,
      hours,
      share: totalRevenue > 0 ? Math.round((r.revenue / totalRevenue) * 1000) / 10 : 0,
      gross,
      margin: r.revenue > 0 ? Math.round((gross / r.revenue) * 1000) / 10 : null,
      grossPerHour: hours > 0 ? Math.round(gross / hours) : null,
      avgLateDays: lateDays.length ? Math.round(lateDays.reduce((a, b) => a + b, 0) / lateDays.length) : null,
      flags: [],
      suggestion: null,
      aiNote: null,
    };
  });
  // 1時間あたりの粗利の平均(作業時間のある顧客)
  const withHours = list.filter((r) => r.hours > 0);
  const avgPerHour = withHours.length ? withHours.reduce((s, r) => s + r.gross, 0) / withHours.reduce((s, r) => s + r.hours, 0) : null;
  for (const r of list) {
    const hasCost = r.cost + r.laborCost > 0;
    if (r.gross < 0) r.flags.push("LOSS");
    else if (hasCost && r.margin !== null && r.margin < 20) r.flags.push("LOW_MARGIN");
    if (avgPerHour !== null && avgPerHour > 0 && r.grossPerHour !== null && r.grossPerHour < avgPerHour * 0.5) r.flags.push("HOURS_HEAVY");
    if ((r.avgLateDays !== null && r.avgLateDays >= 10) || r.overdue > 0) r.flags.push("LATE");
    if (r.flags.includes("LOSS") || r.flags.includes("LOW_MARGIN")) r.suggestion = "RAISE_PRICE";
    else if (r.flags.includes("HOURS_HEAVY")) r.suggestion = "SCOPE";
    else if (r.flags.includes("LATE")) r.suggestion = "TERMS";
  }
  list.sort((a, b) => b.gross - a.gross);

  const findings: string[] = [];
  const costed = list.filter((r) => r.cost + r.laborCost > 0);
  if (!list.length) findings.push("直近12か月に発行した請求書がありません。");
  else {
    const top = [...list].sort((a, b) => b.revenue - a.revenue);
    const n = Math.max(1, Math.ceil(top.length * 0.2));
    const topShare = top.slice(0, n).reduce((s, r) => s + r.share, 0);
    findings.push(`直近12か月の売上(税抜)は ${formatYen(totalRevenue)}、顧客は${list.length}件です。上位${n}件で売上の${Math.round(topShare)}%を占めます。`);
    if (!costed.length) findings.push("顧客ごとの原価・作業時間はまだ分かりません。案件に顧客名を入れ、仕訳や日報を案件に付けると、顧客ごとの粗利が出ます。");
    const loss = list.filter((r) => r.flags.includes("LOSS"));
    if (loss.length) findings.push(`赤字の顧客: ${loss.map((r) => `${r.name}(${yen(r.gross)})`).join("、")}`);
    const low = list.filter((r) => r.flags.includes("LOW_MARGIN"));
    if (low.length) findings.push(`粗利率が20%未満の顧客: ${low.map((r) => `${r.name}(${r.margin}%)`).join("、")}`);
    const heavy = list.filter((r) => r.flags.includes("HOURS_HEAVY"));
    if (heavy.length && avgPerHour !== null) findings.push(`手間のわりに粗利が少ない顧客(1時間あたりの粗利が平均 ${formatYen(Math.round(avgPerHour))} の半分未満): ${heavy.map((r) => `${r.name}(${yen(r.grossPerHour!)})`).join("、")}`);
    const late = list.filter((r) => r.flags.includes("LATE"));
    if (late.length) findings.push(`入金が遅れがちな顧客: ${late.map((r) => `${r.name}(${[r.avgLateDays !== null && r.avgLateDays > 0 ? `平均${r.avgLateDays}日遅れ` : "", r.overdue ? `期日を過ぎた未入金 ${formatYen(r.overdue)}` : ""].filter(Boolean).join("・")})`).join("、")}`);
  }
  return { from: jstDateKey(from), to: today, rows: list, totalRevenue, avgPerHour: avgPerHour === null ? null : Math.round(avgPerHour), hasCosts: costed.length > 0, findings };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "顧客の採算の見立て(2〜3文)" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, action: { type: "string", enum: Object.keys(CUSTOMER_ACTIONS) }, note: { type: "string", description: "次の一手(1文)" } },
        required: ["index", "action", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "items"],
  additionalProperties: false,
};

export async function reviewCustomerProfit(user: { id: string; companyId: string }) {
  const r = await getCustomerProfit(user.companyId);
  if (!r.rows.length) throw new UserError("直近12か月に発行した請求書がありません");
  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  const list = r.rows.slice(0, 40);
  let summary: string | null = null;
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の社長の右腕です。顧客ごとの売上・原価・作業時間の人件費・粗利・粗利率・1時間あたりの粗利・入金の遅れを読み、見立てと、手を打つとよい顧客にだけ次の一手を書いてください。",
            "action: RAISE_PRICE=単価を見直す, SCOPE=作業の範囲を見直す, TERMS=支払い条件を相談, NURTURE=大事にする・取引を増やす, KEEP=このまま。採算の良い大口の顧客には NURTURE を考えてください。数字は渡したものだけを使い、作らないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            period: `${r.from}〜${r.to}`,
            averageGrossPerHour: r.avgPerHour,
            customers: list.map((c, index) => ({ index, name: c.name, invoices: c.invoices, revenue: c.revenue, revenueShare: c.share, cost: c.cost, laborCost: c.laborCost, hours: c.hours, gross: c.gross, margin: c.margin, grossPerHour: c.grossPerHour, avgLateDays: c.avgLateDays, overdue: c.overdue, flags: c.flags })),
          }),
        },
      ],
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const raw = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { summary?: unknown; items?: unknown };
      for (const x of Array.isArray(raw.items) ? raw.items : []) {
        const v = x as { index?: unknown; action?: unknown; note?: unknown };
        const idx = Number(v.index);
        const row = Number.isInteger(idx) ? list[idx] : undefined;
        if (!row || typeof v.action !== "string" || !(v.action in CUSTOMER_ACTIONS)) continue;
        // ルールで見つけた赤字・低い粗利・手間・入金の遅れは、AIが「このまま」と言っても残す
        if (!(v.action === "KEEP" && row.suggestion)) row.suggestion = v.action as CustomerAction;
        const note = typeof v.note === "string" ? v.note.trim().replace(/^AI\s*[:：]\s*/, "").slice(0, 160) : "";
        if (note) row.aiNote = note;
      }
      summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary.trim().slice(0, 500) : null;
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "顧客別の採算", tools: [], mode: summary ? "custprofit-claude" : "custprofit-template" } });
  if (!summary) throw new UserError("AIの見立てを作れませんでした。時間をおいてもう一度お試しください");
  return { ...r, summary };
}
