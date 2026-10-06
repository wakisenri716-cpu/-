import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 社内規程の下書き: 経費精算規程・在宅勤務規程・慶弔見舞金規程を、会社の情報と入力した条件から「第1条〜」の形で作る。
// ・決まったひな形で: 入力した期限・金額などを入れた条文
// ・AIで: ひな形をもとに、会社の事情(メモ)に合わせて条文を直し、確かめるとよい点を挙げる
// 下書きは保存せず、画面で直して印刷・PDF保存する。法令・就業規則との整合は社労士・税理士に確かめてもらう前提。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

export type Article = { title: string; paragraphs: string[] };
export type PolicyKind = "expense" | "telework" | "condolence";

type Field = { key: string; label: string; type: "text" | "number"; default: string | number; unit?: string; min?: number; max?: number };

export const POLICY_KINDS: Record<PolicyKind, { title: string; description: string; fields: Field[] }> = {
  expense: {
    title: "経費精算規程",
    description: "従業員が立て替えた経費の申請・承認・支払いのきまり。",
    fields: [
      { key: "deadlineDays", label: "申請の期限(使った日から)", type: "number", default: 30, unit: "日以内", min: 1, max: 365 },
      { key: "approver", label: "承認する人", type: "text", default: "所属長" },
      { key: "payDay", label: "支払う日", type: "text", default: "毎月25日(申請月の翌月)" },
      { key: "advanceLimit", label: "事前に申請が必要な金額", type: "number", default: 30000, unit: "円以上", max: 100_000_000 },
    ],
  },
  telework: {
    title: "在宅勤務規程",
    description: "自宅などで働くときの対象者・申請・勤務時間・費用のきまり。",
    fields: [
      { key: "eligible", label: "対象になる人", type: "text", default: "勤続3か月以上で、会社が認めた従業員" },
      { key: "maxDays", label: "1週間に在宅勤務できる日数", type: "number", default: 3, unit: "日まで", min: 1, max: 7 },
      { key: "applyBy", label: "申請の期限", type: "text", default: "前日の終業時刻まで" },
      { key: "allowance", label: "在宅勤務手当(月額、なしは0)", type: "number", default: 3000, unit: "円", max: 1_000_000 },
    ],
  },
  condolence: {
    title: "慶弔見舞金規程",
    description: "結婚・出産・弔事・病気・災害のときに会社から贈るお祝い・見舞金のきまり。",
    fields: [
      { key: "marriage", label: "本人の結婚祝い", type: "number", default: 30000, unit: "円", max: 10_000_000 },
      { key: "birth", label: "子の出産祝い", type: "number", default: 10000, unit: "円", max: 10_000_000 },
      { key: "deathSelf", label: "本人の死亡弔慰金", type: "number", default: 100000, unit: "円", max: 10_000_000 },
      { key: "deathSpouse", label: "配偶者の死亡", type: "number", default: 50000, unit: "円", max: 10_000_000 },
      { key: "deathFamily", label: "父母・子の死亡", type: "number", default: 30000, unit: "円", max: 10_000_000 },
      { key: "sickness", label: "病気・けが(入院2週間以上)", type: "number", default: 10000, unit: "円", max: 10_000_000 },
      { key: "disaster", label: "災害(住まいの被害)", type: "number", default: 30000, unit: "円", max: 10_000_000 },
    ],
  },
};

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;
const jpDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

export function parseInputs(kind: PolicyKind, raw: unknown) {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string | number> = {};
  for (const f of POLICY_KINDS[kind].fields) {
    if (f.type === "number") {
      const given = v[f.key] ?? f.default;
      const n = Math.round(Number(given));
      if (String(given).trim() === "" || !Number.isFinite(n) || n < (f.min ?? 0) || n > (f.max ?? 1e9)) throw new UserError(`「${f.label}」を正しく入れてください`);
      out[f.key] = n;
    } else {
      const s = String(v[f.key] ?? f.default).replace(/[\r\n]/g, " ").trim().slice(0, 60);
      out[f.key] = s || String(f.default);
    }
  }
  return out;
}

// 決まったひな形の条文
export function templateArticles(kind: PolicyKind, company: string, input: Record<string, string | number>, effective: string): { articles: Article[]; checkpoints: string[] } {
  const supplement: Article = { title: "附則", paragraphs: [`この規程は、${jpDate(effective)}から施行する。`] };
  if (kind === "expense") {
    return {
      articles: [
        { title: "目的", paragraphs: [`この規程は、${company}(以下「会社」という。)の役員及び従業員(以下「従業員等」という。)が会社の業務のために立て替えた費用(以下「経費」という。)の精算の手続きを定める。`] },
        { title: "対象となる経費", paragraphs: ["精算の対象は、交通費、会議費、消耗品費、通信費その他会社の業務のために必要と認められる費用とする。私的な費用及び業務との関係が明らかでない費用は対象としない。"] },
        { title: "事前の申請", paragraphs: [`1回の支出が${yen(Number(input.advanceLimit))}以上となる見込みのときは、支出の前に${input.approver}の承認を得なければならない。`] },
        { title: "精算の申請", paragraphs: [`従業員等は、経費を支払った日から${input.deadlineDays}日以内に、経費精算のシステムで、日付・支払先・金額・内容を入力し、領収書等を添えて申請する。`, "領収書等は、スマートフォン等で撮影した画像を添付することができる。画像を保存したときの紙の領収書の取扱いは、会社の定める方法による。"] },
        { title: "承認", paragraphs: [`申請は${input.approver}が内容を確かめて承認する。内容に不明な点があるときは、申請者に説明を求め、又は差し戻すことができる。`] },
        { title: "支払い", paragraphs: [`承認された経費は、${input.payDay}に、従業員等の指定する口座に振り込んで支払う。`] },
        { title: "不正の禁止", paragraphs: ["虚偽の申請、二重の申請その他の不正な申請をしてはならない。不正が判明したときは、支払った金額の返還を求め、就業規則に基づき処分することがある。"] },
        { title: "改廃", paragraphs: ["この規程の改廃は、取締役会(取締役会を置かない会社にあっては代表者)の決定による。"] },
        supplement,
      ],
      checkpoints: ["就業規則(懲戒の定め)との整合を確かめてください。", "領収書の画像を保存して紙を捨てる場合は、電子帳簿保存法の要件(スキャナ保存)を税理士に確かめてください。", "申請の期限・支払日が、給与の締め日・支払日と合っているか確かめてください。"],
    };
  }
  if (kind === "telework") {
    const allowance = Number(input.allowance);
    return {
      articles: [
        { title: "目的", paragraphs: [`この規程は、${company}(以下「会社」という。)の従業員が自宅その他会社が認めた場所(以下「自宅等」という。)で勤務すること(以下「在宅勤務」という。)について必要な事項を定める。`, "この規程に定めのない事項は、就業規則の定めによる。"] },
        { title: "対象者", paragraphs: [`在宅勤務の対象者は、${input.eligible}とする。`] },
        { title: "申請と許可", paragraphs: [`在宅勤務をしようとする従業員は、${input.applyBy}に所属長に申請し、許可を得なければならない。在宅勤務は1週間に${input.maxDays}日までとする。`, "業務の都合があるときは、会社は許可を取り消し、出社を命じることができる。"] },
        { title: "勤務時間", paragraphs: ["在宅勤務の勤務時間及び休憩時間は、就業規則の定めによる。従業員は、勤務の開始と終了をタイムカードのシステムに記録する。", "時間外労働、休日労働及び深夜労働は、事前に所属長の許可を得た場合に限る。"] },
        { title: "業務の報告", paragraphs: ["従業員は、所属長の求めに応じて業務の進み具合を報告し、連絡がとれる状態を保たなければならない。"] },
        { title: "情報の管理", paragraphs: ["従業員は、会社の情報及び機器を、会社の定める方法で安全に取り扱わなければならない。家族その他の第三者に会社の情報を見せてはならず、公衆の無線LANなど安全が確かめられない通信を使ってはならない。"] },
        { title: "費用の負担", paragraphs: [allowance > 0 ? `会社は、在宅勤務をした月に、在宅勤務手当として月額${yen(allowance)}を支給する。` : "在宅勤務に伴う通信費・光熱費は、原則として従業員の負担とする。", "業務に必要な機器・消耗品は、会社が貸し出し、又は経費精算規程により精算する。"] },
        { title: "安全と健康", paragraphs: ["従業員は、自宅等の作業環境を整え、健康に配慮して勤務しなければならない。在宅勤務中の業務による負傷等は、労働者災害補償保険の対象となることがある。"] },
        supplement,
      ],
      checkpoints: [
        "就業規則に在宅勤務の定めを置く(又はこの規程を就業規則の一部とする)場合は、労働基準監督署への届出が必要なことがあります。社労士に確かめてください。",
        allowance > 0 ? "決まった額の在宅勤務手当は、給与として所得税・社会保険料の対象になります(実費を精算する場合は扱いが異なります)。" : "通信費・光熱費を会社が負担する場合は、実費の精算方法を決めておきましょう。",
        "労働時間の把握の方法(タイムカード・業務報告)が実際の運用と合っているか確かめてください。",
      ],
    };
  }
  // 0円の項目は条文に入れない
  const amt = (key: string) => Number(input[key]);
  const deaths = [
    ["従業員が死亡したとき", amt("deathSelf")],
    ["従業員の配偶者が死亡したとき", amt("deathSpouse")],
    ["従業員の父母又は子が死亡したとき", amt("deathFamily")],
  ].filter(([, n]) => Number(n) > 0) as [string, number][];
  const condolence: (Article | null)[] = [
    { title: "目的", paragraphs: [`この規程は、${company}(以下「会社」という。)の従業員の慶事及び弔事等に際して、会社が贈る祝金、弔慰金及び見舞金(以下「慶弔見舞金」という。)について定める。`] },
    { title: "対象者", paragraphs: ["この規程は、会社に雇用されている従業員(パートタイマー等を含む。)に適用する。"] },
    amt("marriage") > 0 ? { title: "結婚祝金", paragraphs: [`従業員が結婚したときは、結婚祝金として${yen(amt("marriage"))}を贈る。`] } : null,
    amt("birth") > 0 ? { title: "出産祝金", paragraphs: [`従業員又はその配偶者が出産したときは、出産祝金として${yen(amt("birth"))}を贈る。`] } : null,
    deaths.length
      ? { title: "弔慰金", paragraphs: [`${deaths.map(([when, n]) => `${when}は${yen(n)}を`).join("、")}、弔慰金として贈る。`, ...(amt("deathSelf") > 0 ? ["従業員本人が死亡したときの弔慰金は、遺族に贈る。"] : [])] }
      : null,
    amt("sickness") > 0 ? { title: "傷病見舞金", paragraphs: [`従業員が業務外の病気又はけがにより2週間以上入院したときは、傷病見舞金として${yen(amt("sickness"))}を贈る。`] } : null,
    amt("disaster") > 0 ? { title: "災害見舞金", paragraphs: [`従業員の住居が火災、風水害、地震等の災害により被害を受けたときは、災害見舞金として${yen(amt("disaster"))}を贈る。被害の程度に応じて増減することがある。`] } : null,
    { title: "申請", paragraphs: ["慶弔見舞金を受けようとする従業員(又はその遺族)は、事由の発生から3か月以内に、事由を確かめられる書類を添えて会社に申し出る。"] },
    { title: "改廃", paragraphs: ["この規程の改廃は、取締役会(取締役会を置かない会社にあっては代表者)の決定による。"] },
    supplement,
  ];
  return {
    articles: condolence.filter((a): a is Article => a !== null),
    checkpoints: [
      "慶弔見舞金は、金額が社会通念上ふさわしい範囲なら、受け取る人に所得税がかからない扱いになります。金額の水準は税理士に確かめてください。",
      "会社が支払った慶弔見舞金は、規程に基づき全員に同じ基準で支給すると、会社の福利厚生費として扱いやすくなります。",
      "就業規則に慶弔休暇の定めがあれば、あわせて内容をそろえてください。",
    ],
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    articles: {
      type: "array",
      items: { type: "object", properties: { title: { type: "string", description: "条の見出し(例: 目的)。附則は「附則」" }, paragraphs: { type: "array", items: { type: "string" } } }, required: ["title", "paragraphs"], additionalProperties: false },
    },
    checkpoints: { type: "array", items: { type: "string" }, description: "導入の前に確かめるとよい点(各1文、5つまで)" },
  },
  required: ["articles", "checkpoints"],
  additionalProperties: false,
};

export async function draftPolicy(user: { id: string; companyId: string }, body: { kind?: unknown; inputs?: unknown; effectiveDate?: unknown; notes?: unknown; useAi?: unknown }) {
  const kind = String(body.kind ?? "") as PolicyKind;
  if (!Object.hasOwn(POLICY_KINDS, kind)) throw new UserError("作る規程を選んでください");
  const inputs = parseInputs(kind, body.inputs);
  const effective = String(body.effectiveDate ?? "") || jstDateKey(new Date());
  const t = Date.parse(`${effective}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effective) || Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== effective) throw new UserError("施行日を正しく入れてください");
  const notes = String(body.notes ?? "").trim().slice(0, 1000);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } });
  const base = templateArticles(kind, company.name, inputs, effective);
  const title = POLICY_KINDS[kind].title;
  const ai = body.useAi === true ? await aiFor(user.companyId) : null;
  if (body.useAi === true && !ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  if (!ai) return { kind, title, company: company.name, ...base, mode: "template" as const };

  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  const [staffCount, members] = await Promise.all([prisma.staff.count({ where: { companyId: user.companyId, active: true } }), prisma.companyMember.count({ where: { companyId: user.companyId, active: true } })]);
  let result = { ...base, mode: "template" as "claude" | "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 6000,
      system: [
        {
          type: "text",
          text: [
            "あなたは日本の小さな会社の社内規程づくりを手伝う担当者です。渡したひな形(条文)をもとに、会社の事情(notes)と入力した条件に合わせて条文を直してください。",
            "ひな形の構成(目的から始まり、附則で終わる)と入力した金額・日数・期限は変えず、notes に書かれた事情を条文に反映し、わかりやすい規程の言葉で書いてください。法令の条番号や金額の上限など、渡していない事実は書かないでください。",
            "checkpoints には、導入の前に社労士・税理士と確かめるとよい点を短く書いてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ title, company: company.name, people: { staff: staffCount, members }, inputs, effectiveDate: effective, notes: notes || null, template: base.articles }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const raw = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { articles?: unknown; checkpoints?: unknown };
      const articles = (Array.isArray(raw.articles) ? raw.articles : [])
        .map((a) => a as { title?: unknown; paragraphs?: unknown })
        .filter((a) => typeof a.title === "string" && a.title.trim() && Array.isArray(a.paragraphs))
        .map((a) => ({
          title: String(a.title).replace(/^第\d+条\s*/, "").replace(/[()()]/g, "").trim().slice(0, 30),
          paragraphs: (a.paragraphs as unknown[]).filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim().slice(0, 600)).slice(0, 6),
        }))
        .filter((a) => a.paragraphs.length && a.title !== "附則")
        .slice(0, 30);
      // 附則(施行日)は入力した日のまま、いつも最後に置く
      articles.push(base.articles[base.articles.length - 1]);
      const checkpoints = (Array.isArray(raw.checkpoints) ? raw.checkpoints : []).filter((c): c is string => typeof c === "string" && !!c.trim()).map((c) => c.trim().slice(0, 200)).slice(0, 5);
      if (articles.length >= 4) result = { articles, checkpoints: checkpoints.length ? checkpoints : base.checkpoints, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `${title}の下書き`, tools: [], mode: `policy-${result.mode}` } });
  return { kind, title, company: company.name, ...result };
}
