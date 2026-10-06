import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { cashAccountCodes } from "@/lib/bank/accounts";

// 「この仕訳は何?」: 仕訳1件を、経理に詳しくない人にも分かる言葉で説明する。
// ・決まったルールで: 科目の区分(資産・負債・純資産・収益・費用)から「何が増えて何が減ったか」、利益と現預金への影響、よくある形の名前
// ・AIで: 摘要・取引先・元の書類も読んで、ふつうの言葉の説明と、確かめた方がよい点
// 説明は仕訳ごとに覚えておき、仕訳の中身が変わったら作り直す。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const NOTE_KIND = "JOURNAL_EXPLAIN";

const SOURCE_LABELS: Record<string, string> = {
  EXPENSE_ITEM: "経費精算",
  INVOICE: "請求書",
  PAYMENT: "入金・支払",
  FIXED_ASSET: "固定資産",
  POS_SALE: "POSレジ",
  INVENTORY: "在庫",
  MANUAL: "手入力",
  BANK: "銀行・カード明細",
  PAYROLL: "給料",
  REIMBURSEMENT: "立替経費の精算",
  RECURRING: "定期取引",
  ALLOCATION: "期間按分",
  LOAN: "借入金の返済",
  DEPT_ALLOCATION: "部門配賦",
  OPENING: "開始残高",
  IMPORT: "CSV取り込み",
};
const CATEGORY_LABELS: Record<string, string> = { ASSET: "資産", LIABILITY: "負債", EQUITY: "純資産", REVENUE: "収益", EXPENSE: "費用" };
const DEPRECIATION_TOTAL = "1519";

export type ExplainLine = { side: "借方" | "貸方"; code: string; account: string; category: string; amount: number; meaning: string };
export type JournalExplanation = {
  entryId: string;
  date: string;
  description: string;
  source: string;
  status: string;
  kind: string | null;
  lines: ExplainLine[];
  profitEffect: number;
  cashEffect: number;
  effects: string[];
  story: string;
  points: string[];
  cautions: string[];
  mode: "claude" | "template";
  createdAt: string;
};

type Loaded = Awaited<ReturnType<typeof loadEntry>>;

async function loadEntry(companyId: string, entryId: string) {
  const entry = await prisma.journalEntry.findFirst({
    where: { id: entryId, companyId },
    include: {
      lines: { include: { account: { select: { code: true, name: true, category: true } } } },
      invoice: { select: { direction: true, invoiceNumber: true, vendor: { select: { name: true } }, customer: { select: { name: true } } } },
      expenseItem: { select: { description: true, vendor: { select: { name: true } } } },
      bankTransaction: { select: { description: true } },
      department: { select: { name: true } },
      project: { select: { name: true } },
    },
  });
  if (!entry) throw new UserError("仕訳が見つかりません");
  return entry;
}

// 1行の意味: 区分ごとに、借方なら増えたか減ったか
function meaningOf(code: string, name: string, category: string, side: "借方" | "貸方") {
  const debit = side === "借方";
  if (code === DEPRECIATION_TOTAL) return debit ? `${name}が減った(固定資産の帳簿の価値が戻った)` : `${name}が増えた(固定資産の帳簿の価値を減らした)`;
  switch (category) {
    case "ASSET":
      return debit ? `${name}(資産)が増えた` : `${name}(資産)が減った`;
    case "LIABILITY":
      return debit ? `${name}(負債)が減った` : `${name}(負債)が増えた`;
    case "EQUITY":
      return debit ? `${name}(純資産)が減った` : `${name}(純資産)が増えた`;
    case "REVENUE":
      return debit ? `${name}(収益)が減った(取り消し・値引きなど)` : `${name}(収益)が増えた`;
    default:
      return debit ? `${name}(費用)が増えた` : `${name}(費用)が減った(取り消し・振替など)`;
  }
}

// よくある形に名前を付ける(当てはまらなければ null)
function kindOf(debits: { code: string; category: string }[], credits: { code: string; category: string }[], cash: Set<string>) {
  const d = (f: (x: { code: string; category: string }) => boolean) => debits.some(f);
  const c = (f: (x: { code: string; category: string }) => boolean) => credits.some(f);
  const isCash = (x: { code: string }) => cash.has(x.code);
  if (d((x) => x.code === "1110" || x.code === "1115") && c((x) => x.category === "REVENUE")) return "売上の計上(入金はまだ。売掛金として残る)";
  if (d(isCash) && c((x) => x.code === "1110" || x.code === "1115")) return "売掛金の入金(売上の代金を受け取った)";
  if (d(isCash) && c((x) => x.category === "REVENUE")) return "その場で代金を受け取った売上";
  if (d((x) => x.category === "EXPENSE") && c(isCash)) return "現金・預金で支払った費用";
  if (d((x) => x.category === "EXPENSE") && c((x) => x.code === "2010" || x.code === "2020")) return "あとで支払う費用(買掛金・未払金として残る)";
  if (d((x) => x.code === "2010" || x.code === "2020") && c(isCash)) return "買掛金・未払金の支払い";
  if (d((x) => x.code === "5100") && c((x) => x.code === DEPRECIATION_TOTAL || x.code === "1510")) return "減価償却(固定資産の価値の目減りを費用にした)";
  if (d((x) => x.code === "1510") && c(isCash)) return "固定資産の購入";
  if (d((x) => x.code === "5110" || x.code === "5115")) return "給料・賞与の計上";
  if (d((x) => x.code === "2210") && c(isCash)) return "借入金の返済";
  if (d(isCash) && c((x) => x.code === "2210")) return "お金の借り入れ";
  if (d(isCash) && c(isCash)) return "口座どうしのお金の移動(現金の預け入れ・引き出しなど)";
  if (d((x) => x.code === "1210") && c(isCash)) return "仮払い(使い道が決まる前にお金を渡した)";
  if (d((x) => x.category === "EXPENSE") && c((x) => x.category === "EXPENSE")) return "費用の科目の振り替え(科目を直した)";
  return null;
}

export async function ruleExplanation(companyId: string, entry: Loaded) {
  const cash = new Set(await cashAccountCodes(companyId));
  const lines: ExplainLine[] = entry.lines
    .flatMap((l) => [
      ...(l.debit > 0 ? [{ side: "借方" as const, code: l.account.code, account: l.account.name, category: l.account.category, amount: l.debit }] : []),
      ...(l.credit > 0 ? [{ side: "貸方" as const, code: l.account.code, account: l.account.name, category: l.account.category, amount: l.credit }] : []),
    ])
    .sort((a, b) => (a.side === b.side ? 0 : a.side === "借方" ? -1 : 1))
    .map((l) => ({ ...l, meaning: meaningOf(l.code, l.account, l.category, l.side) }));
  let profit = 0;
  let cashChange = 0;
  for (const l of entry.lines) {
    if (l.account.category === "REVENUE") profit += l.credit - l.debit;
    if (l.account.category === "EXPENSE") profit -= l.debit - l.credit;
    if (cash.has(l.account.code)) cashChange += l.debit - l.credit;
  }
  const kind = kindOf(
    lines.filter((l) => l.side === "借方"),
    lines.filter((l) => l.side === "貸方"),
    cash,
  );
  const effects = [
    profit === 0 ? "利益は変わりません(損益計算書には出ない取引です)" : `利益が${formatYen(Math.abs(profit))}${profit > 0 ? "増えました" : "減りました"}`,
    cashChange === 0 ? "現金・預金の残高は変わりません" : `現金・預金が${formatYen(Math.abs(cashChange))}${cashChange > 0 ? "増えました" : "減りました"}`,
  ];
  const party = entry.invoice?.customer?.name ?? entry.invoice?.vendor?.name ?? entry.expenseItem?.vendor?.name ?? null;
  const debitNames = [...new Set(lines.filter((l) => l.side === "借方").map((l) => l.account))].join("・");
  const creditNames = [...new Set(lines.filter((l) => l.side === "貸方").map((l) => l.account))].join("・");
  const [y, m, d] = jstDateKey(entry.date).split("-").map(Number);
  const story = `${y}年${m}月${d}日の「${entry.description}」${party ? `(${party})` : ""}は、${kind ?? "取引"}の仕訳です。左(借方)に${debitNames}、右(貸方)に${creditNames}を書いています。`;
  const cautions: string[] = [];
  if (entry.status === "PENDING_REVIEW") cautions.push("まだレビュー待ちです。科目と金額を確かめて確定してください");
  if (entry.status === "VOID") cautions.push("この仕訳は取り消し済みで、帳簿の数字には入っていません");
  const debit = entry.lines.reduce((s, l) => s + l.debit, 0);
  const credit = entry.lines.reduce((s, l) => s + l.credit, 0);
  if (debit !== credit) cautions.push(`借方と貸方の合計が合っていません(${formatYen(debit)} と ${formatYen(credit)})`);
  if (lines.some((l) => l.code === "5990")) cautions.push("雑費は中身が分かりにくい科目です。よく使う支払いなら、内容に合う科目にすると後で見やすくなります");
  return { lines, profitEffect: profit, cashEffect: cashChange, effects, kind, story, party, cautions };
}

// 仕訳の中身が変わったら説明を作り直すための印
function signatureOf(entry: Loaded) {
  const body = [entry.description, entry.date.toISOString(), entry.status, ...entry.lines.map((l) => `${l.account.code}:${l.debit}:${l.credit}:${l.memo ?? ""}`).sort()].join("|");
  return createHash("sha256").update(body).digest("hex").slice(0, 32);
}

const SCHEMA = {
  type: "object",
  properties: {
    story: { type: "string", description: "この仕訳が何の取引かを、経理に詳しくない人向けに2〜3文で" },
    points: { type: "array", items: { type: "string" }, description: "科目を選んだ理由や、帳簿・決算・税金でのポイント(最大4つ)" },
    cautions: { type: "array", items: { type: "string" }, description: "確かめた方がよい点(科目違い・金額・消費税・証憑など)。なければ空" },
  },
  required: ["story", "points", "cautions"],
  additionalProperties: false,
};

const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function explainJournal(companyId: string, user: { id: string; name: string }, entryId: string, options: { refresh?: boolean } = {}): Promise<JournalExplanation> {
  const entry = await loadEntry(companyId, entryId);
  const signature = signatureOf(entry);
  const cached = await prisma.aiNote.findUnique({ where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: entryId } } });
  const saved = cached?.data as (JournalExplanation & { signature?: string }) | undefined;
  if (saved && saved.signature === signature && !(options.refresh && saved.mode === "template")) {
    const { signature: _drop, ...rest } = saved;
    void _drop;
    return rest;
  }

  const rule = await ruleExplanation(companyId, entry);
  let story = rule.story;
  let points: string[] = rule.kind ? [`よくある形: ${rule.kind}`] : [];
  let cautions = rule.cautions;
  let mode: "claude" | "template" = "template";

  const ai = await aiFor(companyId);
  if (ai) {
    const since = new Date(`${jstDateKey(new Date())}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 4000,
        system: [
          {
            type: "text",
            text: [
              "あなたは日本の小さな会社の経理担当者で、社長やスタッフに仕訳の意味を説明します。専門用語は使うときに言い換え、短く、具体的に書いてください。",
              "facts の数字(金額・利益への影響・現預金への影響)は計算済みで正しいものです。数字は変えず、書かれていない事実(取引先の事情など)は作らないでください。",
              "cautions には、科目が摘要・取引先と合っていない、金額が不自然、消費税の扱い・証憑の保存で気を付けることなど、確かめた方がよいことだけを書きます。気になる点がなければ空にしてください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              date: jstDateKey(entry.date),
              description: entry.description,
              source: SOURCE_LABELS[entry.sourceType] ?? entry.sourceType,
              status: entry.status,
              party: rule.party,
              invoice: entry.invoice ? { direction: entry.invoice.direction === "ISSUED" ? "発行した請求書" : "受け取った請求書", number: entry.invoice.invoiceNumber } : null,
              expense: entry.expenseItem?.description ?? null,
              bank: entry.bankTransaction?.description ?? null,
              department: entry.department?.name ?? null,
              project: entry.project?.name ?? null,
              lines: rule.lines.map((l) => ({ side: l.side, account: `${l.code} ${l.account}`, category: CATEGORY_LABELS[l.category] ?? l.category, amount: l.amount, memo: entry.lines.find((x) => x.account.code === l.code)?.memo ?? null })),
              facts: { pattern: rule.kind, profitEffect: rule.profitEffect, cashEffect: rule.cashEffect, ruleCautions: rule.cautions },
            }),
          },
        ],
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
        const raw = JSON.parse(text) as { story?: unknown; points?: unknown; cautions?: unknown };
        const s = clean(raw.story, 400);
        if (s) {
          story = s;
          const aiPoints = (Array.isArray(raw.points) ? raw.points : []).map((p) => clean(p, 200)).filter(Boolean).slice(0, 4);
          points = [...points, ...aiPoints].slice(0, 5);
          // ルールで見つけた注意は必ず残し、AIの注意を足す
          const aiCautions = (Array.isArray(raw.cautions) ? raw.cautions : []).map((c) => clean(c, 200)).filter(Boolean).slice(0, 4);
          cautions = [...rule.cautions, ...aiCautions.filter((c) => !rule.cautions.includes(c))].slice(0, 6);
          mode = "claude";
        }
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "仕訳の説明", tools: [], mode: `journal-explain-${mode}` } });
  }

  const result: JournalExplanation = {
    entryId,
    date: jstDateKey(entry.date),
    description: entry.description,
    source: SOURCE_LABELS[entry.sourceType] ?? entry.sourceType,
    status: entry.status,
    kind: rule.kind,
    lines: rule.lines,
    profitEffect: rule.profitEffect,
    cashEffect: rule.cashEffect,
    effects: rule.effects,
    story,
    points,
    cautions,
    mode,
    createdAt: new Date().toISOString(),
  };
  const data = { ...result, signature };
  await prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: entryId } },
    create: { companyId, kind: NOTE_KIND, key: entryId, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
  return result;
}

// AIアシスタント・自分のAIから: 摘要の言葉・日付・金額で仕訳を探す(1件に決まれば説明する)
export async function findAndExplainJournal(companyId: string, user: { id: string; name: string }, input: { keyword?: string; date?: string; amount?: number; entryId?: string }) {
  if (input.entryId) return explainJournal(companyId, user, input.entryId);
  const keyword = (input.keyword ?? "").trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") ? input.date! : null;
  const amount = Number.isInteger(input.amount) && input.amount! > 0 ? input.amount! : null;
  if (!keyword && !date && !amount) return { error: "どの仕訳か分かりません。摘要の言葉・日付・金額のどれかを指定してください" };
  const rows = await prisma.journalEntry.findMany({
    where: {
      companyId,
      // 摘要の言葉か、科目の名前(「雑費の仕訳」)で探す
      ...(keyword ? { OR: [{ description: { contains: keyword, mode: "insensitive" as const } }, { lines: { some: { account: { name: keyword } } } }] } : {}),
      ...(date ? { date: { gte: new Date(`${date}T00:00:00Z`), lt: new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000) } } : {}),
      ...(amount ? { lines: { some: { OR: [{ debit: amount }, { credit: amount }] } } } : {}),
    },
    select: { id: true, date: true, description: true, lines: { select: { debit: true } } },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 10,
  });
  if (!rows.length) return { error: "当てはまる仕訳が見つかりません" };
  if (rows.length > 1) {
    return {
      error: "当てはまる仕訳が複数あります。entryId か、もっと詳しい条件で指定してください",
      candidates: rows.map((r) => ({ entryId: r.id, date: jstDateKey(r.date), description: r.description, amount: r.lines.reduce((s, l) => s + l.debit, 0) })),
    };
  }
  return explainJournal(companyId, user, rows[0].id);
}
