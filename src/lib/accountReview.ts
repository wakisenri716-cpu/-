import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";
import { EXPENSE_ACCOUNT_CODES } from "@/lib/accounting/chartOfAccounts";
import { createManualJournal } from "@/lib/accounting/journal";

// 科目の見直し: 記帳した経費の仕訳の勘定科目が合っているかを見直し、直す仕訳(振替)を作る。
// ・摘要の言葉から(「切手」が雑費、「タクシー」が消耗品費 など)
// ・取引先のふだんの科目から(いつもの科目が決まっている / ふだん同じ科目なのに、この1件だけ違う)
// ・AIが摘要・取引先・金額を読んで、ほかに科目が違いそうなものを探す
// レビュー待ちの仕訳はレビューキューで科目を直せるので、確定した仕訳だけを見る。
// 直すときは元の仕訳はそのままにして、正しい科目へ振り替える仕訳を作る(締めた期間なら今日の日付で)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);
const DAY = 86_400_000;
const SCAN_DAYS = 180;
const HISTORY_DAYS = 365;
const AI_SAMPLE = 60;
const MEMO = "AIの科目見直し";
const FIX_KIND = "ACCOUNT_FIX";
const NOTE_KIND = "ACCOUNT_REVIEW";

// 摘要にこの言葉があれば、この科目のはず(ほかの科目の言葉と重なったときは決めない)
const KEYWORDS: Record<string, RegExp> = {
  "5010": /タクシー|電車|新幹線|乗車券|特急券|航空券|飛行機|Suica|PASMO|ICOCA|高速道路|コインパーキング|宿泊|ホテル|バス代|定期券/i,
  "5020": /打ち合わせ|打合せ|会議室|ミーティング/,
  "5030": /文房具|文具|コピー用紙|トナー|インク|乾電池|事務用品|ボールペン|ファイル|USBメモリ|マウス|キーボード/,
  "5040": /切手|郵便|はがき|ハガキ|レターパック|宅急便|宅配便|ゆうパック|携帯電話|スマホ代|電話料|インターネット|プロバイダ|回線/,
  "5050": /接待|お中元|お歳暮|贈答|手土産|香典|祝い金|ご祝儀|慶弔|会食|ゴルフ/,
  "5060": /家賃|賃料|月極|共益費/,
  "5070": /電気代|電気料|電力|ガス代|ガス料金|水道/,
  "5080": /振込手数料|決済手数料|事務手数料|税理士|司法書士|社労士|行政書士/,
  "5090": /外注|業務委託|制作費|デザイン料/,
};
// 会議費と交際費は、同じ飲食でも人数・金額・相手で変わるので、言葉だけでは直さない
const SOFT_PAIRS = new Set(["5020-5050", "5050-5020"]);

export type SuggestionSource = "keyword" | "vendor" | "ai";
export type Suggestion = {
  lineId: string;
  entryId: string;
  date: string;
  description: string;
  amount: number;
  vendorId: string | null;
  vendorName: string | null;
  from: { code: string; name: string };
  to: { code: string; name: string };
  reason: string;
  source: SuggestionSource;
};

export const SOURCE_LABELS: Record<SuggestionSource, string> = { keyword: "摘要の言葉", vendor: "取引先のいつもの科目", ai: "AIの見立て" };

export function keywordCode(text: string) {
  const hits = Object.entries(KEYWORDS)
    .filter(([, re]) => re.test(text))
    .map(([code]) => code);
  return hits.length === 1 ? hits[0] : null;
}

async function loadLines(companyId: string, now: Date) {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY);
  const [rows, handled, accounts] = await Promise.all([
    prisma.journalLine.findMany({
      where: {
        debit: { gt: 0 },
        account: { companyId, code: { in: EXPENSE_ACCOUNT_CODES } },
        journalEntry: { companyId, status: { in: ["AUTO_POSTED", "POSTED_MANUALLY"] }, date: { gte: since } },
        OR: [{ memo: null }, { memo: { not: MEMO } }],
      },
      select: {
        id: true,
        debit: true,
        account: { select: { code: true, name: true } },
        journalEntry: {
          select: {
            id: true,
            date: true,
            description: true,
            expenseItem: { select: { vendor: { select: { id: true, name: true, defaultExpenseAccount: { select: { code: true } } } } } },
            invoice: { select: { vendor: { select: { id: true, name: true, defaultExpenseAccount: { select: { code: true } } } } } },
          },
        },
      },
      orderBy: { journalEntry: { date: "desc" } },
    }),
    prisma.aiNote.findMany({ where: { companyId, kind: FIX_KIND }, select: { key: true } }),
    prisma.account.findMany({ where: { companyId, code: { in: EXPENSE_ACCOUNT_CODES } }, select: { code: true, name: true } }),
  ]);
  const done = new Set(handled.map((h) => h.key));
  const names = new Map(accounts.map((a) => [a.code, a.name]));
  const lines = rows
    .filter((r) => !done.has(r.id))
    .map((r) => {
      const vendor = r.journalEntry.expenseItem?.vendor ?? r.journalEntry.invoice?.vendor ?? null;
      return {
        lineId: r.id,
        entryId: r.journalEntry.id,
        date: jstDateKey(r.journalEntry.date),
        description: r.journalEntry.description,
        amount: r.debit,
        code: r.account.code,
        name: r.account.name,
        vendorId: vendor?.id ?? null,
        vendorName: vendor?.name ?? null,
        vendorDefault: vendor?.defaultExpenseAccount?.code ?? null,
      };
    });
  return { lines, names };
}

// 決まったルールで見つかる、科目が違いそうな仕訳
export async function findAccountSuspects(companyId: string, now = new Date()) {
  const { lines, names } = await loadLines(companyId, now);
  const scanFrom = jstDateKey(new Date(now.getTime() - SCAN_DAYS * DAY));
  // 取引先ごとの、ふだんの科目
  const byVendor = new Map<string, Map<string, number>>();
  for (const l of lines) {
    if (!l.vendorId) continue;
    const m = byVendor.get(l.vendorId) ?? new Map<string, number>();
    m.set(l.code, (m.get(l.code) ?? 0) + 1);
    byVendor.set(l.vendorId, m);
  }
  const label = (code: string) => ({ code, name: names.get(code) ?? code });
  const suggestions: Suggestion[] = [];
  const recent = lines.filter((l) => l.date >= scanFrom);
  for (const l of recent) {
    const base = { lineId: l.lineId, entryId: l.entryId, date: l.date, description: l.description, amount: l.amount, vendorId: l.vendorId, vendorName: l.vendorName, from: label(l.code) };
    // 取引先のいつもの科目(決めてあるもの → ふだんの記帳)
    if (l.vendorDefault && l.vendorDefault !== l.code && names.has(l.vendorDefault)) {
      suggestions.push({ ...base, to: label(l.vendorDefault), reason: `${l.vendorName}のいつもの科目は「${names.get(l.vendorDefault)}」に決めてあります。`, source: "vendor" });
      continue;
    }
    if (l.vendorId) {
      const counts = byVendor.get(l.vendorId)!;
      const total = [...counts.values()].reduce((s, n) => s + n, 0);
      const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top !== l.code && n >= 3 && n / total >= 0.75) {
        suggestions.push({ ...base, to: label(top), reason: `${l.vendorName}はふだん「${names.get(top)}」です(${total}件中${n}件)。この1件だけ「${l.name}」になっています。`, source: "vendor" });
        continue;
      }
    }
    const code = keywordCode(l.description);
    if (code && code !== l.code && !SOFT_PAIRS.has(`${l.code}-${code}`) && names.has(code)) {
      suggestions.push({ ...base, to: label(code), reason: `摘要に「${l.description.match(KEYWORDS[code])![0]}」とあるので、「${names.get(code)}」が合いそうです。`, source: "keyword" });
    }
  }
  return { suggestions, checked: recent.length, recent, names };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "科目の付け方の全体の所見(80字以内)" },
    suggestions: {
      type: "array",
      description: "科目が違うと考えるものだけ。合っているものは入れない",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "lines の番号" },
          code: { type: "string", enum: EXPENSE_ACCOUNT_CODES, description: "正しいと考える勘定科目のコード" },
          reason: { type: "string", description: "理由(50字以内)" },
        },
        required: ["index", "code", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "suggestions"],
  additionalProperties: false,
} as const;

type NoteData = { summary: string; suggestions: Suggestion[]; checked: number };

// AIに見直してもらう(APIキーがなければ決まったルールの結果だけ)
export async function reviewAccounts(user: { id: string; name: string; companyId: string }) {
  const companyId = user.companyId;
  const today = jstDateKey(new Date());
  const r = await findAccountSuspects(companyId);
  let suggestions = r.suggestions;
  let summary = suggestions.length ? `科目を見直したい仕訳が ${suggestions.length}件 あります。` : `直近${SCAN_DAYS}日の経費の仕訳 ${r.checked}件 を見ましたが、決まったルールでは科目の違いは見つかりませんでした。`;
  let mode = "template";
  const ai = await aiFor(companyId);
  if (ai && r.recent.length) {
    const since = new Date(`${today}T00:00:00+09:00`);
    if ((await prisma.assistantLog.count({ where: { companyId, createdAt: { gte: since } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
    // ルールで見つかったものと、雑費・取引先のないものを優先して、最近の仕訳を読んでもらう
    const flagged = new Set(suggestions.map((s) => s.lineId));
    const pick = [...r.recent].sort((a, b) => Number(flagged.has(b.lineId)) - Number(flagged.has(a.lineId)) || Number(b.code === "5990") - Number(a.code === "5990") || b.amount - a.amount).slice(0, AI_SAMPLE);
    const accounts = EXPENSE_ACCOUNT_CODES.filter((c) => r.names.has(c)).map((c) => `${c} ${r.names.get(c)}`);
    try {
      const response = await ai.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: [
              "あなたは日本の小さな会社の記帳を点検する経理担当者です。経費の仕訳(摘要・取引先・金額・いまの勘定科目)を読み、勘定科目が明らかに違うものだけを選んで、正しい科目と短い理由を書いてください。",
              "迷うもの(会議費と交際費のように、人数・相手が分からないと決められないもの)や、いまの科目でもおかしくないものは選ばないでください。ruleHint はルールでの見立てで、正しければ同じ科目を、違えば正しい科目を書いてください。",
              `使える科目: ${accounts.join("・")}`,
            ].join("\n"),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              pick.map((l, index) => ({ index, date: l.date, description: l.description, vendor: l.vendorName, amount: l.amount, account: `${l.code} ${l.name}`, ruleHint: suggestions.find((s) => s.lineId === l.lineId)?.to.code ?? null })),
            ),
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
        const raw = JSON.parse(text) as { summary?: unknown; suggestions?: unknown };
        const byLine = new Map(suggestions.map((s) => [s.lineId, s]));
        for (const a of Array.isArray(raw.suggestions) ? raw.suggestions : []) {
          const x = a as { index?: unknown; code?: unknown; reason?: unknown };
          const l = pick[Number(x.index)];
          const code = String(x.code ?? "");
          const reason = String(x.reason ?? "").trim().slice(0, 120);
          if (!l || !Number.isInteger(Number(x.index)) || !r.names.has(code) || code === l.code || !reason) continue;
          const prev = byLine.get(l.lineId);
          // 取引先のいつもの科目と食い違うときは、決めてある方を残す
          if (prev?.source === "vendor") continue;
          byLine.set(l.lineId, { lineId: l.lineId, entryId: l.entryId, date: l.date, description: l.description, amount: l.amount, vendorId: l.vendorId, vendorName: l.vendorName, from: { code: l.code, name: l.name }, to: { code, name: r.names.get(code)! }, reason, source: prev && prev.to.code === code ? prev.source : "ai" });
        }
        suggestions = [...byLine.values()];
        const s = String(raw.summary ?? "").trim().slice(0, 160);
        if (s) summary = s;
        mode = "claude";
      }
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
    }
    await prisma.assistantLog.create({ data: { companyId, userId: user.id, question: "科目の見直し", tools: [], mode: `accounts-${mode}` } });
  }
  suggestions.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const data: NoteData = { summary, suggestions, checked: r.checked };
  return prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId, kind: NOTE_KIND, key: today } },
    create: { companyId, kind: NOTE_KIND, key: today, data, mode, createdBy: user.name },
    update: { data, mode, createdBy: user.name, createdAt: new Date() },
  });
}

// 画面に出す見直し候補: いまのルールの結果に、最後にAIが見直した結果を重ねる(直した・合っているとしたものは除く)
export async function getAccountReview(companyId: string) {
  const [r, note, handled] = await Promise.all([
    findAccountSuspects(companyId),
    prisma.aiNote.findFirst({ where: { companyId, kind: NOTE_KIND }, orderBy: { key: "desc" } }),
    prisma.aiNote.findMany({ where: { companyId, kind: FIX_KIND }, select: { key: true } }),
  ]);
  const done = new Set(handled.map((h) => h.key));
  const live = new Map(r.recent.map((l) => [l.lineId, l]));
  const byLine = new Map(r.suggestions.map((s) => [s.lineId, s]));
  const data = (note?.data ?? null) as NoteData | null;
  for (const s of data?.suggestions ?? []) {
    const l = live.get(s.lineId);
    // 科目がもう変わっているもの・消えたものは出さない。取引先のいつもの科目のルールは今の結果を優先する
    if (!l || l.code !== s.from.code || done.has(s.lineId) || byLine.get(s.lineId)?.source === "vendor") continue;
    if (s.source === "ai" || !byLine.has(s.lineId)) byLine.set(s.lineId, s);
  }
  const suggestions = [...byLine.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { suggestions, checked: r.checked, review: note ? { summary: data?.summary ?? "", mode: note.mode, createdAt: note.createdAt.toISOString(), createdBy: note.createdBy } : null };
}

export async function countAccountSuggestions(companyId: string) {
  return (await getAccountReview(companyId)).suggestions.length;
}

// 振替の仕訳を作って直す。setVendorDefault なら、取引先のいつもの科目もこの科目にする
export async function fixAccount(user: { name: string; companyId: string }, lineId: string, toCode: string, setVendorDefault = false) {
  const companyId = user.companyId;
  const line = await prisma.journalLine.findFirst({
    where: { id: lineId, journalEntry: { companyId } },
    include: {
      account: true,
      journalEntry: { include: { expenseItem: { select: { vendorId: true } }, invoice: { select: { vendorId: true } } } },
    },
  });
  if (!line || line.journalEntry.status === "VOID") throw new UserError("仕訳が見つかりません");
  if (line.journalEntry.status === "PENDING_REVIEW") throw new UserError("レビュー待ちの仕訳は、レビューキューで科目を直してください");
  if (!EXPENSE_ACCOUNT_CODES.includes(line.account.code) || line.debit <= 0) throw new UserError("経費の仕訳だけ直せます");
  if (!EXPENSE_ACCOUNT_CODES.includes(toCode)) throw new UserError("直す先の科目を選んでください");
  if (toCode === line.account.code) throw new UserError("同じ科目です");
  const to = await prisma.account.findUnique({ where: { companyId_code: { companyId, code: toCode } } });
  if (!to) throw new UserError("直す先の科目が見つかりません");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { booksClosedThrough: true } });
  const closed = company.booksClosedThrough ? jstDateKey(company.booksClosedThrough) : null;
  const original = jstDateKey(line.journalEntry.date);
  const today = jstDateKey(new Date());
  const date = closed && original <= closed ? today : original;
  // 先に「直した」と記録して、二重に振り替えないようにする
  try {
    await prisma.aiNote.create({ data: { companyId, kind: FIX_KIND, key: lineId, data: { status: "fixed", to: toCode }, mode: "fixed", createdBy: user.name } });
  } catch {
    throw new UserError("この仕訳はもう見直し済みです");
  }
  try {
    const entry = await createManualJournal(companyId, {
      date: new Date(`${date}T00:00:00Z`),
      description: `科目の振替(${line.account.name}→${to.name}): ${line.journalEntry.description}`.slice(0, 200),
      lines: [
        { accountId: to.id, debit: line.debit, credit: 0, memo: MEMO },
        { accountId: line.accountId, debit: 0, credit: line.debit, memo: MEMO },
      ],
      departmentId: line.journalEntry.departmentId,
      projectId: line.journalEntry.projectId,
    });
    await prisma.aiNote.update({ where: { companyId_kind_key: { companyId, kind: FIX_KIND, key: lineId } }, data: { data: { status: "fixed", to: toCode, entryId: entry.id } } });
    const vendorId = line.journalEntry.expenseItem?.vendorId ?? line.journalEntry.invoice?.vendorId ?? null;
    if (setVendorDefault && vendorId) await prisma.vendor.updateMany({ where: { id: vendorId, companyId }, data: { defaultExpenseAccountId: to.id } });
    return { entryId: entry.id, date, from: line.account.name, to: to.name, amount: line.debit, vendorUpdated: !!(setVendorDefault && vendorId), note: `${formatYen(line.debit)} を「${line.account.name}」から「${to.name}」へ振り替えました${date !== original ? `(締めた期間なので ${date} の日付で)` : ""}` };
  } catch (error) {
    await prisma.aiNote.delete({ where: { companyId_kind_key: { companyId, kind: FIX_KIND, key: lineId } } }).catch(() => {});
    throw error;
  }
}

// 「この科目で合っている」として、見直し候補から外す
export async function keepAccount(user: { name: string; companyId: string }, lineId: string) {
  const line = await prisma.journalLine.findFirst({ where: { id: lineId, journalEntry: { companyId: user.companyId } }, select: { id: true } });
  if (!line) throw new UserError("仕訳が見つかりません");
  await prisma.aiNote.upsert({
    where: { companyId_kind_key: { companyId: user.companyId, kind: FIX_KIND, key: lineId } },
    create: { companyId: user.companyId, kind: FIX_KIND, key: lineId, data: { status: "ok" }, mode: "ok", createdBy: user.name },
    update: {},
  });
  return { ok: true };
}
