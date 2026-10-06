import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { findOrCreateVendor } from "@/lib/accounting/parties";
import { addItemsToExpenses } from "@/lib/expenseQuickAdd";

// ひとことで経費入力: 「昨日 タクシー 2,400円」「10/3 打ち合わせのカフェ 1,200円」のような文章から、
// AIが日付・内容・金額・勘定科目・支払先を読み取って経費精算の明細の下書きにする。確認してから入れる。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const MAX_TEXT = 2000;
const MAX_ITEMS = 20;
const MAX_AMOUNT = 1_000_000;
const DAY = 86_400_000;

export type DraftItem = { date: string; description: string; amount: number; accountCode: string; vendorName: string | null; confidence: number; note: string | null };

const KEYWORDS: [RegExp, string][] = [
  [/タクシー|電車|バス|新幹線|交通|運賃|suica|pasmo|ic|駐車|高速|ガソリン|飛行機/i, "5010"],
  [/会議|打ち?合わ?せ|カフェ|コーヒー|喫茶|お茶/, "5020"],
  [/文具|文房具|コピー|用紙|消耗|電池|インク|トナー|備品/, "5030"],
  [/切手|郵便|宅配|送料|電話|通信|携帯|ネット/, "5040"],
  [/接待|会食|懇親|手土産|お土産|贈答|お祝い|ご祝儀/, "5050"],
  [/電気|ガス|水道/, "5070"],
  [/手数料|振込料/, "5080"],
];

// 「昨日」「今日」「一昨日」「10/3」「10月3日」「2026-10-03」を日付にする(年がなければ、今日より先にならない年にする)
export function parseDate(text: string, today: string): { date: string | null; rest: string } {
  const t = Date.parse(`${today}T00:00:00Z`);
  const key = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const rel: [RegExp, number][] = [
    [/一昨日|おととい/, -2],
    [/昨日|きのう/, -1],
    [/今日|きょう|本日/, 0],
  ];
  for (const [re, n] of rel) if (re.test(text)) return { date: key(t + n * DAY), rest: text.replace(re, " ") };
  const full = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?/);
  if (full) return { date: `${full[1]}-${full[2].padStart(2, "0")}-${full[3].padStart(2, "0")}`, rest: text.replace(full[0], " ") };
  const md = text.match(/(\d{1,2})[/月](\d{1,2})日?/);
  if (md) {
    const y = Number(today.slice(0, 4));
    let d = `${y}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    if (d > today) d = `${y - 1}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    return { date: d, rest: text.replace(md[0], " ") };
  }
  return { date: null, rest: text };
}

// APIキーがないときの読み取り(1行に1件)
export function templateParse(text: string, today: string): DraftItem[] {
  const items: DraftItem[] = [];
  for (const raw of text.normalize("NFKC").split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const { date, rest } = parseDate(line, today);
    const amountMatch = rest.match(/[¥￥]\s*([\d,]+)|([\d,]+)\s*円/) ?? rest.match(/([\d,]{3,})(?!.*\d)/);
    const amount = amountMatch ? Number((amountMatch[1] ?? amountMatch[2] ?? "").replace(/,/g, "")) : 0;
    // かっこの中は店名・支払先として扱う
    const vendor = rest.match(/[(]([^()]{1,40})[)]/);
    const description = rest
      .replace(amountMatch?.[0] ?? "", " ")
      .replace(vendor?.[0] ?? "", " ")
      .replace(/[、,。]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hit = KEYWORDS.find(([re]) => re.test(description));
    items.push({
      date: date ?? today,
      description: description || "経費",
      amount,
      accountCode: hit?.[1] ?? "5990",
      vendorName: vendor?.[1].trim() || null,
      confidence: hit && date && amount ? 0.95 : 0.6,
      note: !amount ? "金額を読み取れませんでした" : !date ? "日付がないので今日にしました" : !hit ? "科目がわからないので雑費にしました" : null,
    });
  }
  return items.slice(0, MAX_ITEMS);
}

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          description: { type: "string", description: "内容(例: 取引先A社との打ち合わせ カフェ代)" },
          amount: { type: "integer", description: "税込の金額(円)" },
          accountCode: { type: "string", enum: EXPENSE_ACCOUNT_CODES },
          vendorName: { type: ["string", "null"], description: "店名・支払先(書かれていれば)" },
          confidence: { type: "number", description: "読み取りの確かさ 0〜1" },
          note: { type: ["string", "null"], description: "確かめてほしいこと(なければ null)" },
        },
        required: ["date", "description", "amount", "accountCode", "vendorName", "confidence", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

// 読み取った下書きを確かめて整える(日付は1年以内で今日まで、金額は1円〜100万円、科目は経費の科目だけ)
export function sanitizeItems(raw: unknown, today: string): DraftItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - 365 * DAY).toISOString().slice(0, 10);
  return list.slice(0, MAX_ITEMS).map((r: Record<string, unknown>) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date)) && !Number.isNaN(Date.parse(String(r.date))) ? String(r.date) : today;
    const amount = Math.round(Number(r?.amount) || 0);
    const notes: string[] = r?.note ? [String(r.note).slice(0, 100)] : [];
    if (date > today || date < oldest) notes.push("日付が今日より先か1年より前です");
    if (amount <= 0 || amount > MAX_AMOUNT) notes.push("金額を確かめてください");
    const confidence = Math.min(1, Math.max(0, Number(r?.confidence) || 0));
    return {
      date,
      description: String(r?.description ?? "").trim().slice(0, 100) || "経費",
      amount,
      accountCode: EXPENSE_ACCOUNT_CODES.includes(String(r?.accountCode)) ? String(r.accountCode) : "5990",
      vendorName: r?.vendorName ? String(r.vendorName).trim().slice(0, 60) || null : null,
      confidence: notes.length > (r?.note ? 1 : 0) ? Math.min(confidence, 0.5) : confidence,
      note: notes.length ? notes.join("。") : null,
    };
  });
}

export async function parseExpenseText(user: { id: string; companyId: string }, textValue: unknown, today = jstDateKey(new Date())) {
  const text = String(textValue ?? "").trim();
  if (!text) throw new UserError("経費の内容を書いてください");
  if (text.length > MAX_TEXT) throw new UserError(`${MAX_TEXT}文字以内で書いてください`);
  await ensureChartOfAccounts(user.companyId);
  let items: DraftItem[] = templateParse(text, today);
  let mode = "template";
  const ai = await aiFor(user.companyId);
  if (ai) {
    const since = new Date(`${today}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) {
      throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    }
    const accounts = await prisma.account.findMany({ where: { companyId: user.companyId, code: { in: EXPENSE_ACCOUNT_CODES } }, select: { code: true, name: true } });
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは経費精算の入力を手伝う係です。従業員が書いた文章から、立て替えた経費を1件ずつ読み取ってください。",
              "1行に複数の経費があれば分け、往復・2人分などは書かれた合計金額のまま1件にしてください。金額が書かれていない経費は amount を 0 にして note で知らせてください。",
              "日付は今日を基準に「昨日」「先週の金曜」なども YYYY-MM-DD にしてください。年が書かれていなければ、今日より先にならない年にしてください。",
              `勘定科目は次から選んでください: ${accounts.map((a) => `${a.code} ${a.name}`).join("、")}。迷うときは confidence を低くし、note に理由を書いてください。`,
              "経費ではないもの(私的な買い物と書かれているもの・売上など)は入れないでください。",
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: `今日は ${today} です。\n---\n${text}` }],
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      });
      if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
        const out = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim();
        items = sanitizeItems((JSON.parse(out) as { items?: unknown }).items, today);
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "ひとことで経費入力", tools: [], mode: `expense-text-${mode}` } });
  }
  // 取引先に既定科目があれば(人が決めた・AIが修正から覚えた)、その科目にする
  const names = [...new Set(items.flatMap((i) => (i.vendorName ? [i.vendorName] : [])))];
  if (names.length) {
    const vendors = await prisma.vendor.findMany({ where: { companyId: user.companyId, name: { in: names }, defaultExpenseAccountId: { not: null } }, select: { name: true, defaultExpenseAccount: { select: { code: true } } } });
    for (const it of items) {
      const v = vendors.find((x) => x.name === it.vendorName);
      if (v?.defaultExpenseAccount && EXPENSE_ACCOUNT_CODES.includes(v.defaultExpenseAccount.code) && v.defaultExpenseAccount.code !== it.accountCode) {
        it.accountCode = v.defaultExpenseAccount.code;
        it.note = [it.note, "取引先の既定科目にしました"].filter(Boolean).join("。");
      }
    }
  }
  return { items, mode };
}

// 確かめた下書きを、本人の経費精算に入れる
export async function addDraftItems(user: { id: string; companyId: string }, raw: unknown, today = jstDateKey(new Date())) {
  const items = sanitizeItems(raw, today);
  if (!items.length) throw new UserError("入れる経費がありません");
  const bad = items.find((i) => i.amount <= 0 || i.amount > MAX_AMOUNT || i.date > today);
  if (bad) throw new UserError(`「${bad.description}」の金額か日付を確かめてください`);
  const withVendor = [];
  for (const i of items) {
    const vendor = i.vendorName ? await findOrCreateVendor(user.companyId, i.vendorName) : null;
    withVendor.push({ description: i.description, amount: i.amount, date: i.date, accountCode: i.accountCode, confidence: Math.min(i.confidence, 0.95), vendorId: vendor?.id ?? null });
  }
  return addItemsToExpenses(user, withVendor, "text");
}
