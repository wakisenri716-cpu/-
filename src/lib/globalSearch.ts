import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import type { Prisma } from "@prisma/client";

// すべてのデータから探す: 請求書・見積書・発注書・仕訳・経費・契約・取引先・書類を、言葉・期間・金額でまとめて探す。
// 「先月のA社の請求書」「10万円以上の経費」のような文は、決まったルールで期間・金額・種類を読み取り、
// 読み取れない言い回しは AI が条件に直す(AI は条件を作るだけで、探すのはいつもデータベース)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const PER_KIND = 20;
const DAY = 86_400_000;

export const SEARCH_KINDS = ["invoice", "quote", "order", "journal", "expense", "contract", "party", "file"] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];
export const KIND_LABELS: Record<SearchKind, string> = {
  invoice: "請求書",
  quote: "見積書",
  order: "発注書",
  journal: "仕訳",
  expense: "経費",
  contract: "契約書",
  party: "取引先",
  file: "書類",
};

export type SearchFilters = {
  keywords: string[];
  kinds: SearchKind[];
  direction: "ISSUED" | "RECEIVED" | null;
  from: string | null;
  to: string | null;
  min: number | null;
  max: number | null;
};

export type SearchHit = { kind: SearchKind; id: string; title: string; subtitle: string; date: string | null; amount: number | null; status: string | null; href: string };

const KIND_WORDS: [RegExp, SearchKind[], SearchFilters["direction"]?][] = [
  [/受け取った請求書|受領した?請求書|届いた請求書|支払う請求書/, ["invoice"], "RECEIVED"],
  [/発行した請求書|送った請求書|出した請求書/, ["invoice"], "ISSUED"],
  [/請求書|請求/, ["invoice"]],
  [/見積書?|見積もり/, ["quote"]],
  [/発注書?|注文書/, ["order"]],
  [/仕訳/, ["journal"]],
  [/経費|立替|領収書|レシート/, ["expense"]],
  [/契約書?/, ["contract"]],
  [/取引先|顧客|お客様|仕入先|得意先/, ["party"]],
  [/書類|ファイル|PDF|資料/i, ["file"]],
];
const FILLERS = /(を|が|は)?(探して|さがして|見せて|教えて|出して|表示して|一覧|検索|ください|全部|すべて|ある\??|どこ\??|ありますか\??)/g;
const PARTICLES = /^(の|を|で|に|は|が|と|から|まで|より|へ|や)+|(の|を|で|に|は|が|と|から|まで|より|へ|や)+$/g;

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthRange = (y: number, m: number): [string, string] => [ymd(y, m, 1), ymd(y, m, lastDay(y, m))];
const shiftDays = (key: string, n: number) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);

function yen(num: string, man?: string) {
  const n = Number(num.replace(/,/g, ""));
  return man ? Math.round(n * 10_000) : n;
}

// 決まったルールで、文から条件を読み取る
export function parseSearch(text: string, today = jstDateKey(new Date())): SearchFilters {
  let rest = ` ${text.normalize("NFKC").trim()} `;
  const take = (re: RegExp) => {
    const m = re.exec(rest);
    if (m) rest = rest.replace(m[0], " ");
    return m;
  };
  const [ty, tm] = today.split("-").map(Number);
  const f: SearchFilters = { keywords: [], kinds: [], direction: null, from: null, to: null, min: null, max: null };

  for (const [re, kinds, direction] of KIND_WORDS) {
    if (take(re)) {
      for (const k of kinds) if (!f.kinds.includes(k)) f.kinds.push(k);
      if (direction) f.direction = direction;
    }
  }

  // 期間
  let m: RegExpExecArray | null;
  if ((m = take(/(\d{4})-(\d{1,2})-(\d{1,2})/))) f.from = f.to = ymd(+m[1], +m[2], +m[3]);
  else if ((m = take(/(\d{4})年(\d{1,2})月(\d{1,2})日/))) f.from = f.to = ymd(+m[1], +m[2], +m[3]);
  else if ((m = take(/(\d{4})年(\d{1,2})月/))) [f.from, f.to] = monthRange(+m[1], +m[2]);
  else if ((m = take(/(\d{4})年(度)?/))) [f.from, f.to] = [ymd(+m[1], 1, 1), ymd(+m[1], 12, 31)];
  else if ((m = take(/(\d{1,2})月(\d{1,2})日/))) f.from = f.to = ymd(ty, +m[1], +m[2]);
  else if ((m = take(/(\d{1,2})月(分)?/))) {
    const mm = +m[1];
    if (mm >= 1 && mm <= 12) [f.from, f.to] = monthRange(mm > tm ? ty - 1 : ty, mm);
  } else if (take(/今日/)) f.from = f.to = today;
  else if (take(/昨日/)) f.from = f.to = shiftDays(today, -1);
  else if (take(/今週/)) [f.from, f.to] = [shiftDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7)), today];
  else if (take(/先週/)) {
    const monday = shiftDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    [f.from, f.to] = [shiftDays(monday, -7), shiftDays(monday, -1)];
  } else if (take(/今月/)) [f.from, f.to] = monthRange(ty, tm);
  else if (take(/先月|前月/)) [f.from, f.to] = tm === 1 ? monthRange(ty - 1, 12) : monthRange(ty, tm - 1);
  else if (take(/今年/)) [f.from, f.to] = [ymd(ty, 1, 1), ymd(ty, 12, 31)];
  else if (take(/去年|昨年/)) [f.from, f.to] = [ymd(ty - 1, 1, 1), ymd(ty - 1, 12, 31)];
  else if ((m = take(/(?:最近|直近|この)(\d{1,3})日/))) [f.from, f.to] = [shiftDays(today, -Number(m[1])), today];

  // 金額
  const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(万)?\s*円?`;
  if ((m = take(new RegExp(`${AMOUNT}\\s*(?:以上|超|から)`)))) f.min = yen(m[1], m[2]);
  if ((m = take(new RegExp(`${AMOUNT}\\s*(?:以下|未満|まで)`)))) f.max = yen(m[1], m[2]);
  if (f.min === null && f.max === null && (m = take(new RegExp(`${AMOUNT}(?=\\s|$|の)`))) && (m[2] || /円/.test(m[0]))) f.min = f.max = yen(m[1], m[2]);

  rest = rest.replace(FILLERS, " ");
  f.keywords = rest
    .split(/[\s、,・]+/)
    .map((w) => w.replace(PARTICLES, "").replace(/(さん|様|さま|御中|殿)$/, "").trim())
    .filter((w) => w && !/^(の|を|で|に|は|が|と|から|まで|社)$/.test(w))
    .slice(0, 5);
  return f;
}

// 決まったルールで読み切れなかった文は AI に条件へ直してもらう(使えないときはルールの結果のまま)
export async function parseWithAi(companyId: string, userId: string, text: string, rule: SearchFilters, today = jstDateKey(new Date())) {
  const ai = await aiFor(companyId);
  if (!ai) return { filters: rule, mode: "template" as const };
  const since = new Date(`${today}T00:00:00+09:00`);
  if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) return { filters: rule, mode: "template" as const };
  let filters = rule;
  let mode: "claude" | "template" = "template";
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [
        {
          type: "text",
          text: [
            "あなたは会計ソフトの検索窓です。利用者の文を、データベースを探す条件に直してください。",
            `今日は ${today} です。期間は YYYY-MM-DD で、なければ null。金額は円の整数で、なければ null。`,
            "kinds は探す種類(invoice=請求書, quote=見積書, order=発注書, journal=仕訳, expense=経費, contract=契約書, party=取引先, file=書類)。指定がなければ空。",
            "keywords は取引先名・品名・摘要などに含まれる言葉(助詞や「探して」などは入れない)。direction は請求書の向き(ISSUED=発行した, RECEIVED=受け取った, なければ null)。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ text, ruleGuess: rule }) }],
      output_config: {
        effort: "low",
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              keywords: { type: "array", items: { type: "string" } },
              kinds: { type: "array", items: { type: "string", enum: [...SEARCH_KINDS] } },
              direction: { type: ["string", "null"], enum: ["ISSUED", "RECEIVED", null] },
              from: { type: ["string", "null"] },
              to: { type: ["string", "null"] },
              min: { type: ["integer", "null"] },
              max: { type: ["integer", "null"] },
            },
            required: ["keywords", "kinds", "direction", "from", "to", "min", "max"],
            additionalProperties: false,
          },
        },
      },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const raw = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as Record<string, unknown>;
      filters = sanitize(raw);
      mode = "claude";
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId, userId, question: "データの検索", tools: [], mode: `search-${mode}` } });
  return { filters, mode };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function sanitize(raw: Record<string, unknown>): SearchFilters {
  const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const date = (v: unknown) => (typeof v === "string" && DATE_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
  return {
    keywords: (Array.isArray(raw.keywords) ? raw.keywords : [])
      .map((k) => String(k).trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 5),
    kinds: (Array.isArray(raw.kinds) ? raw.kinds : []).filter((k): k is SearchKind => SEARCH_KINDS.includes(k as SearchKind)),
    direction: raw.direction === "ISSUED" || raw.direction === "RECEIVED" ? raw.direction : null,
    from: date(raw.from),
    to: date(raw.to),
    min: int(raw.min),
    max: int(raw.max),
  };
}

// 画面のURL(?kinds=... など)から条件を読む
export function filtersFromParams(p: Record<string, string | undefined>): SearchFilters {
  return sanitize({
    keywords: (p.kw ?? "").split(/\s+/),
    kinds: (p.kinds ?? "").split(",").filter(Boolean),
    direction: p.dir ?? null,
    from: p.from ?? null,
    to: p.to ?? null,
    min: p.min ? Number(p.min) : null,
    max: p.max ? Number(p.max) : null,
  });
}

const range = (f: SearchFilters) => (f.from || f.to ? { ...(f.from ? { gte: new Date(`${f.from}T00:00:00Z`) } : {}), ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + DAY) } : {}) } : undefined);
const amountRange = (f: SearchFilters) => (f.min !== null || f.max !== null ? { ...(f.min !== null ? { gte: f.min } : {}), ...(f.max !== null ? { lte: f.max } : {}) } : undefined);
const has = (word: string) => ({ contains: word, mode: "insensitive" as const });
const dateKey = (d: Date | null | undefined) => (d ? jstDateKey(d) : null);
// 言葉はすべて含むもの(AND)。1つの言葉は、どれかの欄に含まれればよい
const every = <T>(f: SearchFilters, fields: (w: string) => T[]) => (f.keywords.length ? { AND: f.keywords.map((w) => ({ OR: fields(w) })) } : {});

export async function runSearch(companyId: string, f: SearchFilters) {
  const want = (k: SearchKind) => !f.kinds.length || f.kinds.includes(k);
  const dates = range(f);
  const amounts = amountRange(f);
  const jobs: Promise<SearchHit[]>[] = [];

  if (want("invoice")) {
    const where: Prisma.InvoiceWhereInput = {
      companyId,
      ...(f.direction ? { direction: f.direction } : {}),
      ...(dates ? { OR: [{ issueDate: dates }, { issueDate: null, createdAt: dates }] } : {}),
      ...(amounts ? { totalAmount: amounts } : {}),
      ...every<Prisma.InvoiceWhereInput>(f, (w) => [{ invoiceNumber: has(w) }, { notes: has(w) }, { customer: { name: has(w) } }, { vendor: { name: has(w) } }, { lines: { some: { description: has(w) } } }]),
    };
    jobs.push(
      prisma.invoice
        .findMany({ where, include: { customer: { select: { name: true } }, vendor: { select: { name: true } } }, orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }], take: PER_KIND })
        .then((rows) =>
          rows.map((r) => ({
            kind: "invoice" as const,
            id: r.id,
            title: `${r.direction === "ISSUED" ? "発行" : "受取"} ${r.invoiceNumber ?? "(番号なし)"}`,
            subtitle: r.customer?.name ?? r.vendor?.name ?? "",
            date: dateKey(r.issueDate ?? r.createdAt),
            amount: r.totalAmount,
            status: r.status,
            href: `/invoices/${r.id}`,
          })),
        ),
    );
  }
  if (want("quote")) {
    jobs.push(
      prisma.quote
        .findMany({
          where: { companyId, ...(dates ? { issueDate: dates } : {}), ...(amounts ? { totalAmount: amounts } : {}), ...every<Prisma.QuoteWhereInput>(f, (w) => [{ quoteNumber: has(w) }, { notes: has(w) }, { customer: { name: has(w) } }, { lines: { some: { description: has(w) } } }]) },
          include: { customer: { select: { name: true } } },
          orderBy: { issueDate: "desc" },
          take: PER_KIND,
        })
        .then((rows) => rows.map((r) => ({ kind: "quote" as const, id: r.id, title: `見積 ${r.quoteNumber}`, subtitle: r.customer.name, date: dateKey(r.issueDate), amount: r.totalAmount, status: r.status, href: `/quotes/${r.id}` }))),
    );
  }
  if (want("order")) {
    jobs.push(
      prisma.purchaseOrder
        .findMany({
          where: { companyId, ...(dates ? { issueDate: dates } : {}), ...(amounts ? { totalAmount: amounts } : {}), ...every<Prisma.PurchaseOrderWhereInput>(f, (w) => [{ orderNumber: has(w) }, { notes: has(w) }, { vendor: { name: has(w) } }, { lines: { some: { description: has(w) } } }]) },
          include: { vendor: { select: { name: true } } },
          orderBy: { issueDate: "desc" },
          take: PER_KIND,
        })
        .then((rows) => rows.map((r) => ({ kind: "order" as const, id: r.id, title: `発注 ${r.orderNumber}`, subtitle: r.vendor.name, date: dateKey(r.issueDate), amount: r.totalAmount, status: r.status, href: `/purchase-orders/${r.id}` }))),
    );
  }
  if (want("journal")) {
    jobs.push(
      prisma.journalEntry
        .findMany({
          where: {
            companyId,
            ...(dates ? { date: dates } : {}),
            ...(amounts ? { lines: { some: { OR: [{ debit: amounts }, { credit: amounts }] } } } : {}),
            ...every<Prisma.JournalEntryWhereInput>(f, (w) => [{ description: has(w) }, { lines: { some: { memo: has(w) } } }, { lines: { some: { account: { name: w } } } }]),
          },
          include: { lines: { select: { debit: true, account: { select: { name: true } } } } },
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map((r) => ({
            kind: "journal" as const,
            id: r.id,
            title: r.description,
            subtitle: [...new Set(r.lines.map((l) => l.account.name))].join("・"),
            date: dateKey(r.date),
            amount: r.lines.reduce((s, l) => s + l.debit, 0),
            status: r.status,
            href: `/journal?q=${encodeURIComponent(r.description)}`,
          })),
        ),
    );
  }
  if (want("expense")) {
    jobs.push(
      prisma.expenseItem
        .findMany({
          where: { expenseReport: { companyId }, ...(dates ? { expenseDate: dates } : {}), ...(amounts ? { amount: amounts } : {}), ...every<Prisma.ExpenseItemWhereInput>(f, (w) => [{ description: has(w) }, { vendor: { name: has(w) } }, { expenseReport: { employee: { name: has(w) } } }]) },
          include: { vendor: { select: { name: true } }, expenseReport: { select: { id: true, status: true, employee: { select: { name: true } } } } },
          orderBy: { expenseDate: "desc" },
          take: PER_KIND,
        })
        .then((rows) =>
          rows.map((r) => ({
            kind: "expense" as const,
            id: r.id,
            title: r.description,
            subtitle: [r.expenseReport.employee?.name, r.vendor?.name].filter(Boolean).join(" ・ "),
            date: dateKey(r.expenseDate),
            amount: r.amount,
            status: r.expenseReport.status,
            href: `/expenses/${r.expenseReport.id}`,
          })),
        ),
    );
  }
  if (want("contract")) {
    jobs.push(
      prisma.contract
        .findMany({
          where: {
            companyId,
            ...(dates ? { OR: [{ startDate: dates }, { endDate: dates }] } : {}),
            ...(amounts ? { amount: amounts } : {}),
            ...every<Prisma.ContractWhereInput>(f, (w) => [{ title: has(w) }, { counterparty: has(w) }, { summary: has(w) }]),
          },
          orderBy: { updatedAt: "desc" },
          take: PER_KIND,
        })
        .then((rows) => rows.map((r) => ({ kind: "contract" as const, id: r.id, title: r.title, subtitle: r.counterparty ?? "", date: dateKey(r.endDate ?? r.startDate), amount: r.amount, status: r.status, href: "/contracts" }))),
    );
  }
  // 取引先・書類は期間・金額では絞らない(言葉があるときだけ探す)
  if (want("party") && f.keywords.length && !dates && !amounts) {
    jobs.push(
      Promise.all([
        prisma.customer.findMany({ where: { companyId, ...every<Prisma.CustomerWhereInput>(f, (w) => [{ name: has(w) }, { contactName: has(w) }, { email: has(w) }, { payerName: has(w) }]) }, take: PER_KIND, orderBy: { name: "asc" } }),
        prisma.vendor.findMany({ where: { companyId, ...every<Prisma.VendorWhereInput>(f, (w) => [{ name: has(w) }, { contactName: has(w) }, { registrationNumber: has(w) }]) }, take: PER_KIND, orderBy: { name: "asc" } }),
      ]).then(([cs, vs]) => [
        ...cs.map((c) => ({ kind: "party" as const, id: c.id, title: c.name, subtitle: ["顧客", c.contactName].filter(Boolean).join(" ・ "), date: null, amount: null, status: null, href: `/vendors/customer/${c.id}` })),
        ...vs.map((v) => ({ kind: "party" as const, id: v.id, title: v.name, subtitle: ["仕入先", v.contactName].filter(Boolean).join(" ・ "), date: null, amount: null, status: null, href: `/vendors/vendor/${v.id}` })),
      ]),
    );
  }
  if (want("file") && (f.keywords.length || dates) && !amounts) {
    jobs.push(
      prisma.storedFile
        .findMany({ where: { companyId, ...(dates ? { createdAt: dates } : {}), ...every<Prisma.StoredFileWhereInput>(f, (w) => [{ name: has(w) }, { memo: has(w) }]) }, orderBy: { createdAt: "desc" }, take: PER_KIND })
        .then((rows) => rows.map((r) => ({ kind: "file" as const, id: r.id, title: r.name, subtitle: r.memo ?? r.uploadedByName, date: dateKey(r.createdAt), amount: null, status: null, href: `/files/${r.id}` }))),
    );
  }

  const hits = (await Promise.all(jobs)).flat();
  const groups = SEARCH_KINDS.map((kind) => ({ kind, label: KIND_LABELS[kind], hits: hits.filter((h) => h.kind === kind) })).filter((g) => g.hits.length);
  return { groups, total: hits.length };
}

export function hasCondition(f: SearchFilters) {
  return f.keywords.length > 0 || f.from !== null || f.to !== null || f.min !== null || f.max !== null || f.kinds.length > 0;
}

// 決まったルールで読み切れたか(残った言葉が長い文のままなら AI に任せる)
// (ひらがなが続く言葉が残る = 「〜してほしいのですが」のような話し言葉。長い言葉が残るときも)
export function looksNatural(text: string, rule: SearchFilters) {
  return rule.keywords.some((k) => k.length >= 10 || /[ぁ-ん]{4,}/.test(k)) || rule.keywords.length >= 4;
}
