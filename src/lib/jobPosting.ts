import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { formatYen } from "@/lib/format";

// 求人票の下書き: 入れた条件から、求人票に書くべき項目(業務内容・契約期間・試用期間・就業場所・時間・休日・賃金・保険・
// 業務と就業場所の「変更の範囲」など)をそろえた下書きを作る。年齢・性別などで応募を制限する言い方がないかをルールで確かめ、
// AIが使えるときは、仕事内容とアピールを読みやすく書き直す(制限する言い方が入ったら使わない)。何も保存しない。
// 法令の判断は一般的な目安。最低賃金・例外の扱いはハローワーク・社労士に確かめる前提。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

export const JOB_TYPES = { REGULAR: "正社員", CONTRACT: "契約社員", PART: "パート・アルバイト" } as const;
export type JobType = keyof typeof JOB_TYPES;
export const INSURANCES = ["雇用保険", "労災保険", "健康保険", "厚生年金"] as const;

export type JobInput = {
  title: string;
  type: JobType;
  duties: string;
  workplace: string;
  workplaceChange: string;
  dutiesChange: string;
  hours: string;
  holidays: string;
  wageType: "HOURLY" | "MONTHLY";
  wageMin: number;
  wageMax: number | null;
  allowances: string;
  trial: string;
  contract: string;
  insurances: string[];
  appeal: string;
  apply: string;
  notes: string;
};

const s = (v: unknown, max: number) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

export function parseJobInput(raw: Record<string, unknown>): JobInput {
  const title = s(raw.title, 40).replace(/\n/g, " ");
  if (!title) throw new UserError("職種を入れてください");
  const type = String(raw.type ?? "") as JobType;
  if (!Object.hasOwn(JOB_TYPES, type)) throw new UserError("雇用形態を選んでください");
  const duties = s(raw.duties, 2000);
  if (!duties) throw new UserError("仕事内容を入れてください");
  const wageType = raw.wageType === "MONTHLY" ? "MONTHLY" : "HOURLY";
  const wageMin = Math.round(Number(raw.wageMin));
  const wageMaxRaw = raw.wageMax === undefined || raw.wageMax === null || raw.wageMax === "" ? null : Math.round(Number(raw.wageMax));
  const cap = wageType === "HOURLY" ? 100_000 : 10_000_000;
  if (!Number.isFinite(wageMin) || wageMin <= 0 || wageMin > cap) throw new UserError("賃金(下限)を正しく入れてください");
  if (wageMaxRaw !== null && (!Number.isFinite(wageMaxRaw) || wageMaxRaw < wageMin || wageMaxRaw > cap)) throw new UserError("賃金(上限)は下限以上で入れてください");
  const insurances = (Array.isArray(raw.insurances) ? raw.insurances : []).map(String).filter((x): x is (typeof INSURANCES)[number] => (INSURANCES as readonly string[]).includes(x));
  return {
    title,
    type,
    duties,
    workplace: s(raw.workplace, 200),
    workplaceChange: s(raw.workplaceChange, 200),
    dutiesChange: s(raw.dutiesChange, 200),
    hours: s(raw.hours, 300),
    holidays: s(raw.holidays, 300),
    wageType,
    wageMin,
    wageMax: wageMaxRaw,
    allowances: s(raw.allowances, 300),
    trial: s(raw.trial, 200),
    contract: s(raw.contract, 300),
    insurances: [...new Set(insurances)],
    appeal: s(raw.appeal, 1000),
    apply: s(raw.apply, 300),
    notes: s(raw.notes, 1000),
  };
}

// 年齢・性別・国籍などで応募を制限する(またはそう読める)言い方
const NG: [RegExp, string][] = [
  [/\d{2}\s*代(?:の方)?(?:まで|限定|のみ|歓迎|活躍中|中心)/, "年齢(◯代)で応募を絞る言い方です。年齢は原則として制限できません(例外はハローワークで確かめてください)。"],
  [/\d{2}\s*歳(?:まで|以下|未満|くらいまで|位まで)/, "年齢の上限です。年齢は原則として制限できません(定年を上限にするなどの例外は、理由の書き方が決まっています)。"],
  [/若い(?:方|人)|若手|フレッシュな/, "若い人を求めるように読めます。年齢を限るのと同じに受け取られることがあります。"],
  [/(?:女性|男性)(?:の方)?(?:のみ|限定|歓迎|活躍|向け|募集)/, "性別で応募を絞る言い方です。性別を理由に募集を分けることはできません。"],
  [/主婦(?!\s*[((]夫[))])(?:・主夫)?(?:の方)?(?:歓迎|活躍|限定|のみ|向け)/, "「主婦」だけだと女性向けに読めます。「主婦(夫)」や「家事と両立したい方」などにしましょう。"],
  [/ママさん|ママ(?:が|も)活躍|お母さん/, "女性向けに読めます。「子育て中の方」などにしましょう。"],
  [/(?:ウェイトレス|ウエイトレス|ウェイター|ウエイター|スチュワーデス|看護婦|保母|営業マン|カメラマン|セールスマン)/, "性別を連想させる職種名です。「ホールスタッフ」「看護師」「保育士」「営業職」などにしましょう。"],
  [/日本人(?:のみ|限定)|外国人不可|国籍/, "国籍で応募を絞る言い方です。"],
  [/健康な(?:方|人)|持病のない/, "健康状態で絞るように読めます。仕事に必要な条件(例: 重い荷物を運ぶ)として具体的に書きましょう。"],
];

export type JobCheck = { level: "ng" | "warn" | "info"; text: string; quote?: string };

export function checkJob(input: JobInput, texts: string[]): JobCheck[] {
  const checks: JobCheck[] = [];
  const all = texts.join("\n");
  for (const [re, why] of NG) {
    const m = all.match(re);
    if (m) checks.push({ level: "ng", text: why, quote: m[0] });
  }
  const missing: string[] = [];
  if (!input.workplace) missing.push("就業場所");
  if (!input.workplaceChange) missing.push("就業場所の変更の範囲");
  if (!input.dutiesChange) missing.push("業務の変更の範囲");
  if (!input.hours) missing.push("就業時間");
  if (!input.holidays) missing.push("休日");
  if (!input.trial) missing.push("試用期間(なければ「なし」)");
  if (input.type !== "REGULAR" && !input.contract) missing.push("契約期間と更新のルール");
  if (!input.insurances.length) missing.push("加入する保険");
  if (missing.length) checks.push({ level: "warn", text: `求人票に書くべき項目が空です: ${missing.join("・")}。` });
  if (input.hours && !/休憩/.test(input.hours)) checks.push({ level: "warn", text: "就業時間に休憩時間を書きましょう(6時間を超えるなら45分以上、8時間を超えるなら60分以上が必要です)。" });
  if (/残業|時間外/.test(input.hours + input.notes) === false && input.type !== "PART") checks.push({ level: "info", text: "時間外労働(残業)があるかどうか、あれば月の平均時間を書くと親切です。" });
  if (input.wageType === "HOURLY") checks.push({ level: "info", text: `時給 ${formatYen(input.wageMin)} が、働く場所の都道府県の最低賃金(毎年10月ごろに上がります)を下回っていないか確かめてください。` });
  if (input.type === "REGULAR" && input.contract) checks.push({ level: "info", text: "正社員で契約期間を書いています。期間の定めがない雇用なら「期間の定めなし」にしましょう。" });
  if (/固定残業|みなし残業/.test(input.allowances + input.notes)) checks.push({ level: "warn", text: "固定残業代は、金額・何時間分か・超えた分は別に払うことを書く必要があります。" });
  return checks;
}

export type JobPosting = {
  catchphrase: string;
  rows: { label: string; text: string }[];
  appeal: string;
  checks: JobCheck[];
  mode: "claude" | "template";
};

const wageText = (i: JobInput) => {
  const unit = i.wageType === "HOURLY" ? "時給" : "月給";
  return `${unit} ${formatYen(i.wageMin)}${i.wageMax && i.wageMax > i.wageMin ? ` 〜 ${formatYen(i.wageMax)}` : ""}${i.wageMax && i.wageMax > i.wageMin ? "(経験・能力により決定)" : ""}`;
};

export function templatePosting(company: string, i: JobInput, duties = i.duties, appeal = i.appeal, catchphrase = ""): Omit<JobPosting, "checks" | "mode"> {
  const rows: { label: string; text: string }[] = [
    { label: "会社名", text: company },
    { label: "職種", text: i.title },
    { label: "雇用形態", text: JOB_TYPES[i.type] },
    { label: "仕事内容", text: duties },
    { label: "業務の変更の範囲", text: i.dutiesChange || "(未入力)" },
    { label: "就業場所", text: i.workplace || "(未入力)" },
    { label: "就業場所の変更の範囲", text: i.workplaceChange || "(未入力)" },
    { label: "就業時間", text: i.hours || "(未入力)" },
    { label: "休日", text: i.holidays || "(未入力)" },
    { label: "賃金", text: wageText(i) },
  ];
  if (i.allowances) rows.push({ label: "手当", text: i.allowances });
  rows.push({ label: "契約期間", text: i.type === "REGULAR" ? i.contract || "期間の定めなし" : i.contract || "(未入力)" });
  rows.push({ label: "試用期間", text: i.trial || "(未入力)" });
  rows.push({ label: "加入保険", text: i.insurances.length ? i.insurances.join("・") : "(未入力)" });
  if (i.apply) rows.push({ label: "応募方法", text: i.apply });
  return { catchphrase: catchphrase || `${i.title}(${JOB_TYPES[i.type]})を募集しています`, rows, appeal };
}

const SCHEMA = {
  type: "object",
  properties: {
    catchphrase: { type: "string", description: "求人のキャッチコピー(30文字以内)" },
    duties: { type: "string", description: "仕事内容(箇条書きは「・」で。改行は \\n)" },
    appeal: { type: "string", description: "職場のアピール(3〜5文)" },
  },
  required: ["catchphrase", "duties", "appeal"],
  additionalProperties: false,
};

export async function draftJobPosting(user: { id: string; companyId: string }, raw: Record<string, unknown>) {
  const input = parseJobInput(raw);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } });
  const base = templatePosting(company.name, input);
  const baseChecks = checkJob(input, [input.title, input.duties, input.appeal, input.notes, input.allowances]);
  if (raw.useAi !== true) return { ...base, checks: baseChecks, mode: "template" as const };
  const ai = await aiFor(user.companyId);
  if (!ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: JobPosting = { ...base, checks: baseChecks, mode: "template" };
  let rejected = false;
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の求人票を書く担当者です。入れた条件から、仕事内容(1日の流れや具体的な作業がわかるように)と職場のアピールを、応募したくなる読みやすい文にしてください。",
            "条件(賃金・時間・休日・保険・場所)は書き換えず、渡していない待遇・数字・実績は作らないでください。",
            "年齢・性別・国籍・健康状態などで応募者を限る、またはそう読める言い方(「20代活躍中」「女性歓迎」「若い方」「主婦歓迎」「ウェイトレス」など)は使わないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ company: company.name, title: input.title, type: JOB_TYPES[input.type], duties: input.duties, wage: wageText(input), hours: input.hours, holidays: input.holidays, workplace: input.workplace, appeal: input.appeal || null, notes: input.notes || null }) }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens") {
      const out = JSON.parse(
        response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join(""),
      ) as { catchphrase?: unknown; duties?: unknown; appeal?: unknown };
      const catchphrase = typeof out.catchphrase === "string" ? out.catchphrase.replace(/[\r\n]/g, " ").trim().slice(0, 40) : "";
      const duties = typeof out.duties === "string" ? out.duties.trim().slice(0, 2000) : "";
      const appeal = typeof out.appeal === "string" ? out.appeal.trim().slice(0, 1000) : "";
      if (duties) {
        // AIの文に、制限する言い方が入っていたら使わない
        const aiNg = checkJob(input, [catchphrase, duties, appeal]).filter((c) => c.level === "ng" && !baseChecks.some((b) => b.quote === c.quote));
        if (aiNg.length) rejected = true;
        else result = { ...templatePosting(company.name, input, duties, appeal || input.appeal, catchphrase), checks: baseChecks, mode: "claude" };
      }
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `求人票の下書き(${input.title})`, tools: [], mode: `job-${result.mode}${rejected ? "-rejected" : ""}` } });
  if (rejected) result.checks = [{ level: "info", text: "AIの文に応募を制限するように読める言い方が入ったため、使いませんでした(入れた文のままです)。" }, ...result.checks];
  return result;
}
