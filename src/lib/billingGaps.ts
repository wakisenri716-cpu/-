import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// 請求漏れのチェック: 出し忘れている請求書がないかを探す。
// ・毎月の請求: 前の4か月のうち3か月以上請求している顧客に、今月まだ請求していない(いつもの請求日を過ぎたら)
//   (定期発行に登録してある顧客は自動で発行されるので除く)
// ・受注した商談: 受注から90日以内で、受注後にその顧客への請求書がない
// ・見積: 出して2週間以上たつのに、請求書にしていない見積(有効期限が30日以上前に切れたものは除く)
// 「今月は請求しない」「対応済み」とした項目は外す。AIは、全体の見立てと項目ごとの確かめ方を一言ずつ書く。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const BILLED = ["PENDING_REVIEW", "CONFIRMED", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;
const NOTE_KIND = "BILLING_GAPS";
const OK_KIND = "BILLING_GAP_OK";

export type GapKind = "MONTHLY" | "DEAL" | "QUOTE";
export type Gap = { key: string; kind: GapKind; level: "warn" | "info"; customer: string; title: string; detail: string; amount: number | null; href: string; hrefLabel: string; aiNote: string | null };

export const GAP_LABELS: Record<GapKind, string> = { MONTHLY: "毎月の請求", DEAL: "受注した商談", QUOTE: "請求書にしていない見積" };

const addMonths = (month: string, n: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
};

export async function findBillingGaps(companyId: string, today = jstDateKey(new Date())) {
  const month = today.slice(0, 7);
  const months = [1, 2, 3, 4].map((n) => addMonths(month, -n));
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const [invoices, recurring, deals, quotes, oks] = await Promise.all([
    prisma.invoice.findMany({
      where: { companyId, direction: "ISSUED", status: { in: [...BILLED] }, customerId: { not: null }, issueDate: { gte: new Date(`${months[3]}-01T00:00:00Z`) } },
      select: { id: true, customerId: true, issueDate: true, subtotalAmount: true, customer: { select: { name: true } } },
      orderBy: { issueDate: "asc" },
    }),
    prisma.recurringInvoice.findMany({ where: { companyId, active: true }, select: { templateInvoice: { select: { customerId: true } } } }),
    prisma.deal.findMany({ where: { companyId, stage: "WON", amount: { gt: 0 }, closedAt: { gte: new Date(todayMs - 90 * DAY) } }, select: { id: true, title: true, customerName: true, amount: true, closedAt: true } }),
    prisma.quote.findMany({
      where: { companyId, status: "OPEN", issueDate: { lte: new Date(todayMs - 14 * DAY) }, validUntil: { gte: new Date(todayMs - 30 * DAY) } },
      select: { id: true, quoteNumber: true, issueDate: true, validUntil: true, subtotalAmount: true, customer: { select: { name: true } } },
      orderBy: { issueDate: "asc" },
    }),
    prisma.aiNote.findMany({ where: { companyId, kind: OK_KIND }, select: { key: true } }),
  ]);
  const ok = new Set(oks.map((o) => o.key));
  const auto = new Set(recurring.flatMap((r) => (r.templateInvoice.customerId ? [r.templateInvoice.customerId] : [])));
  const gaps: Gap[] = [];

  // 毎月の請求
  const byCustomer = new Map<string, typeof invoices>();
  for (const inv of invoices) byCustomer.set(inv.customerId!, [...(byCustomer.get(inv.customerId!) ?? []), inv]);
  const day = Number(today.slice(8));
  for (const [customerId, list] of byCustomer) {
    if (auto.has(customerId)) continue;
    const key = `MONTHLY:${customerId}:${month}`;
    if (ok.has(key)) continue;
    const billedMonths = new Set(list.map((i) => jstDateKey(i.issueDate!).slice(0, 7)));
    if (billedMonths.has(month)) continue;
    const count = months.filter((m) => billedMonths.has(m)).length;
    if (count < 3) continue;
    const past = list.filter((i) => jstDateKey(i.issueDate!).slice(0, 7) !== month);
    const usualDay = median(past.map((i) => Number(jstDateKey(i.issueDate!).slice(8))));
    if (day < usualDay) continue;
    const last3 = past.slice(-3);
    const amount = median(last3.map((i) => i.subtotalAmount));
    const last = past[past.length - 1];
    const late = day - usualDay;
    gaps.push({
      key,
      kind: "MONTHLY",
      level: late >= 3 ? "warn" : "info",
      customer: list[0].customer?.name ?? "",
      title: `${list[0].customer?.name}に今月の請求書を出していません`,
      detail: `前の4か月のうち${count}か月請求しています(いつもは${usualDay}日ごろ、税抜 ${formatYen(amount)} くらい)。${late >= 3 ? `いつもの請求日から${late}日過ぎています。` : "いつもの請求日です。"}`,
      amount,
      href: `/invoices/new?from=${last.id}`,
      hrefLabel: "前回の請求書を写して作る",
      aiNote: null,
    });
  }

  // 受注した商談
  if (deals.length) {
    const names = [...new Set(deals.map((d) => d.customerName))];
    const after = await prisma.invoice.findMany({
      where: { companyId, direction: "ISSUED", status: { notIn: ["CANCELLED"] }, customer: { name: { in: names } } },
      select: { issueDate: true, createdAt: true, customer: { select: { name: true } } },
    });
    for (const d of deals) {
      const key = `DEAL:${d.id}`;
      if (ok.has(key)) continue;
      const closed = d.closedAt!;
      const billed = after.some((i) => i.customer?.name === d.customerName && (i.issueDate ?? i.createdAt).getTime() >= closed.getTime() - DAY);
      if (billed) continue;
      const days = Math.round((todayMs - Date.parse(`${jstDateKey(closed)}T00:00:00Z`)) / DAY);
      gaps.push({
        key,
        kind: "DEAL",
        level: days >= 30 ? "warn" : "info",
        customer: d.customerName,
        title: `受注した「${d.title}」の請求書がありません`,
        detail: `${jstDateKey(closed).replaceAll("-", "/")}に受注(${formatYen(d.amount)})してから${days}日、${d.customerName}への請求書がありません。納品が済んでいれば請求しましょう。`,
        amount: d.amount,
        href: "/invoices/new",
        hrefLabel: "請求書を作る",
        aiNote: null,
      });
    }
  }

  // 請求書にしていない見積
  for (const q of quotes) {
    const key = `QUOTE:${q.id}`;
    if (ok.has(key)) continue;
    const days = Math.round((todayMs - q.issueDate.getTime()) / DAY);
    const expired = jstDateKey(q.validUntil) < today;
    gaps.push({
      key,
      kind: "QUOTE",
      level: "info",
      customer: q.customer.name,
      title: `見積 ${q.quoteNumber}(${q.customer.name})を請求書にしていません`,
      detail: `見積を出して${days}日たちます(税抜 ${formatYen(q.subtotalAmount)}${expired ? "・有効期限切れ" : ""})。受注していれば請求書に、断られていれば見積を取り消してください。`,
      amount: q.subtotalAmount,
      href: `/quotes/${q.id}`,
      hrefLabel: "見積を開く",
      aiNote: null,
    });
  }
  const rank = { warn: 0, info: 1 };
  gaps.sort((a, b) => rank[a.level] - rank[b.level]);
  return { today, month, gaps };
}

type NoteData = { summary: string; notes: Record<string, string> };

export async function getBillingGaps(companyId: string) {
  const r = await findBillingGaps(companyId);
  const note = await prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: r.today } } });
  const data = note ? (note.data as NoteData) : null;
  return {
    ...r,
    gaps: r.gaps.map((g) => ({ ...g, aiNote: data?.notes?.[g.key] ?? null })),
    review: note && data ? { summary: data.summary, mode: note.mode, createdAt: note.createdAt.toISOString(), createdBy: note.createdBy } : null,
  };
}

export async function countBillingGaps(companyId: string) {
  return (await findBillingGaps(companyId)).gaps.length;
}

// 「今月は請求しない」「対応済み」として外す
export async function dismissBillingGap(user: { name: string; companyId: string }, key: string) {
  if (!/^(MONTHLY:[\w-]+:\d{4}-\d{2}|DEAL:[\w-]+|QUOTE:[\w-]+)$/.test(key)) throw new UserError("項目が正しくありません");
  const r = await findBillingGaps(user.companyId);
  if (!r.gaps.some((g) => g.key === key)) throw new UserError("その項目は見つかりません(もう片付いています)");
  await prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId: user.companyId, kind: OK_KIND, key } },
    create: { companyId: user.companyId, kind: OK_KIND, key, data: { status: "ok" }, mode: "ok", createdBy: user.name },
    update: {},
  });
  return { ok: true };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "請求漏れの見立て(100字以内)" },
    notes: {
      type: "array",
      items: { type: "object", properties: { index: { type: "integer" }, note: { type: "string", description: "確かめ方・次の一手(60字以内)" } }, required: ["index", "note"], additionalProperties: false },
    },
  },
  required: ["summary", "notes"],
  additionalProperties: false,
} as const;

export async function reviewBillingGaps(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const r = await findBillingGaps(companyId);
  const total = r.gaps.reduce((s, g) => s + (g.amount ?? 0), 0);
  let summary = r.gaps.length ? `出し忘れかもしれない請求が ${r.gaps.length}件(税抜 ${formatYen(total)} ほど)あります。` : "請求漏れは見つかりませんでした。";
  const notes: Record<string, string> = {};
  let mode = "template";
  if (process.env.ANTHROPIC_API_KEY && r.gaps.length) {
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: new Date(`${r.today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    const pick = r.gaps.slice(0, 40);
    try {
      const response = await new Anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは小さな会社の請求業務を手伝う経理担当者です。出し忘れかもしれない請求(JSON)を読み、経営者向けに全体の見立てと、項目ごとに何を確かめて次にどうするかを一言ずつ書いてください。",
              "毎月の請求なら今月も同じ内容でよいか、受注した商談なら納品や検収が済んだか、見積なら受注したか断られたかを確かめる、のように具体的に書いてください。金額は「1,234円」の形で、データにないことは推測で書かないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: JSON.stringify({ today: r.today, gaps: pick.map((g, index) => ({ index, kind: GAP_LABELS[g.kind], customer: g.customer, title: g.title, detail: g.detail, amount: g.amount })) }) }],
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
        const raw = JSON.parse(text) as { summary?: unknown; notes?: unknown };
        for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
          const x = n as { index?: unknown; note?: unknown };
          const g = Number.isInteger(Number(x.index)) ? pick[Number(x.index)] : undefined;
          const note = String(x.note ?? "").trim().slice(0, 120);
          if (g && note) notes[g.key] = note;
        }
        const s = String(raw.summary ?? "").trim().slice(0, 200);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "請求漏れのチェック", tools: [], mode: `billing-${mode}` } });
  }
  const data: NoteData = { summary, notes };
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: r.today } },
    create: { companyId, kind: NOTE_KIND, key: r.today, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
}
