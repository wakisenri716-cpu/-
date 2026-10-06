import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";
import { addMonth, businessDay, incomeTaxSpecialPeriod, monthlyPeriod, residentTaxSpecialPeriod, type Period } from "@/lib/withholding/rules";

// 税金・労務の年間カレンダー: 会社の設定(決算月・納期の特例・社会保険の加入者・固定資産など)から、
// これから12か月の申告・届出・納付の期限を並べる。源泉所得税・住民税は「源泉徴収・納付」で納付済みにすると自動で「済み」。
// ほかはチェックで「済み」にする。AI(またはひな形)が近い期限の段取りを書く。.ics でスマホのカレンダーにも入れられる。
// 期限は一般的な目安(土日は次の月曜日。祝日は考えない)。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

export type CalendarCategory = "tax" | "social" | "labor";
export const CATEGORY_LABEL: Record<CalendarCategory, string> = { tax: "税金", social: "社会保険", labor: "労務" };

export type CalendarEvent = {
  key: string; // 「種類:期間」。チェックの保存に使う
  kind: string;
  title: string;
  detail: string;
  category: CalendarCategory;
  start?: string; // 受付が始まる日(あれば)
  due: string; // 期限
  link?: string;
  auto: boolean; // 納付済みの記録から自動で判定する
  done: boolean;
  doneBy?: string;
  status: "done" | "overdue" | "soon" | "later";
  note?: string; // 条件つきのもの(「前期の法人税が20万円を超えたとき」など)
};

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthOf = (key: string) => key.slice(0, 7);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const shortDate = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
// 月末(土日なら次の月曜日)
const monthEnd = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m - 1, 1));
  return businessDay(d.getUTCFullYear(), d.getUTCMonth() + 1, lastDay(d.getUTCFullYear(), d.getUTCMonth() + 1));
};

export type CalendarFacts = {
  fiscalYearStartMonth: number;
  withholdingSpecial: boolean;
  residentTaxSpecial: boolean;
  overtimeStartMonth: number;
  employees: number; // 在籍スタッフ
  socialInsured: number; // 健康保険・厚生年金の加入者
  residentTaxPayers: number; // 住民税を特別徴収している人
  fixedAssets: number; // 持っている固定資産
  invoiceIssuer: boolean; // 適格請求書発行事業者(登録番号あり)
};

type Draft = Omit<CalendarEvent, "done" | "doneBy" | "status">;

// 期間 [from, to] に期限がある予定(チェック前)
export function buildEvents(f: CalendarFacts, from: string, to: string): Draft[] {
  const out: Draft[] = [];
  const inRange = (due: string) => due >= from && due <= to;
  const firstMonth = monthOf(from);
  const months = Array.from({ length: Math.ceil(daysBetween(from, to) / 28) + 14 }, (_, i) => addMonth(firstMonth, i - 13)).filter((m) => m <= monthOf(to));
  const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];

  // 源泉所得税(給与・賞与・士業の報酬)
  if (f.employees > 0) {
    const periods = new Map<string, Period>();
    for (const m of months) {
      const p = f.withholdingSpecial ? incomeTaxSpecialPeriod(m) : monthlyPeriod(m);
      periods.set(p.key, p);
    }
    for (const p of periods.values())
      if (inRange(p.deadline))
        out.push({
          key: `INCOME_TAX:${p.key}`,
          kind: "incomeTax",
          title: `源泉所得税の納付(${p.label})`,
          detail: f.withholdingSpecial ? "納期の特例: 半年分の給与・士業の報酬から預かった源泉所得税をまとめて納めます。" : "前の月に払った給与・賞与・報酬から預かった源泉所得税を納めます。",
          category: "tax",
          due: p.deadline,
          link: "/withholding",
          auto: true,
        });
  }
  // 住民税(特別徴収)
  if (f.residentTaxPayers > 0) {
    const periods = new Map<string, Period>();
    for (const m of months) {
      const p = f.residentTaxSpecial ? residentTaxSpecialPeriod(m) : monthlyPeriod(m);
      periods.set(p.key, p);
    }
    for (const p of periods.values())
      if (inRange(p.deadline))
        out.push({ key: `RESIDENT_TAX:${p.key}`, kind: "residentTax", title: `住民税(特別徴収)の納付(${p.label})`, detail: "給与から引いた住民税を、住んでいる市区町村ごとに納めます。", category: "tax", due: p.deadline, link: "/withholding", auto: true });
  }
  // 社会保険料(前月分を月末に口座振替)
  if (f.socialInsured > 0)
    for (const m of months) {
      const [y, mo] = m.split("-").map(Number);
      const due = monthEnd(y, mo);
      const prev = addMonth(m, -1);
      if (inRange(due)) out.push({ key: `SOCIAL:${prev}`, kind: "social", title: `社会保険料の納付(${Number(prev.slice(5))}月分)`, detail: "健康保険・厚生年金の保険料(会社負担分と本人から預かった分)が口座から引き落とされます。残高を確かめておきます。", category: "social", due, link: "/payroll", auto: false });
    }

  for (const y of years) {
    if (f.socialInsured > 0) {
      const due = businessDay(y, 7, 10);
      if (inRange(due)) out.push({ key: `SANTEI:${y}`, kind: "santei", title: "算定基礎届(標準報酬月額の見直し)", detail: "4〜6月の給与をもとに、9月からの社会保険料の基準を届け出ます。", category: "social", start: `${y}-07-01`, due, link: "/payroll/standard", auto: false });
    }
    if (f.employees > 0) {
      const due = businessDay(y, 7, 10);
      if (inRange(due)) out.push({ key: `NENKO:${y}`, kind: "laborInsurance", title: "労働保険の年度更新", detail: "前の年度(4月〜3月)に払った賃金の総額から、労災保険・雇用保険の保険料を申告して納めます。", category: "labor", start: `${y}-06-01`, due, link: "/payroll", auto: false });
      // 36協定: 起算日の前日までに届け出る
      const start = `${y}-${pad(f.overtimeStartMonth)}-01`;
      const day = new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      if (inRange(day)) out.push({ key: `SABUROKU:${y}`, kind: "saburoku", title: "36協定の届出(時間外・休日労働)", detail: `残業や休日出勤をさせるときは、起算日(${Number(f.overtimeStartMonth)}月1日)の前日までに労働基準監督署へ届け出ます(毎年)。`, category: "labor", due: day, link: "/leave", auto: false });
      const yec = `${y}-12-25`;
      if (inRange(yec)) out.push({ key: `NENCHO:${y}`, kind: "yearEnd", title: "年末調整", detail: "扶養控除等申告書・保険料控除申告書などを集め、12月の最後の給与で1年分の所得税を精算します(期限は目安)。", category: "tax", start: `${y}-11-01`, due: yec, link: "/year-end", auto: false });
      const jan = businessDay(y, 1, 31);
      if (inRange(jan)) {
        out.push({ key: `HOTEI:${y - 1}`, kind: "statutory", title: `法定調書合計表・源泉徴収票の提出(${y - 1}年分)`, detail: "前の年の給与・報酬の源泉徴収票と支払調書、その合計表を税務署に出します。", category: "tax", due: jan, link: "/year-end", auto: false });
        out.push({ key: `KYUYO:${y - 1}`, kind: "salaryReport", title: `給与支払報告書の提出(${y - 1}年分)`, detail: "従業員が住んでいる市区町村ごとに、前の年の給与の支払報告書を出します(翌年度の住民税の計算に使われます)。", category: "tax", due: jan, link: "/year-end", auto: false });
      }
    }
    if (f.fixedAssets > 0) {
      const due = businessDay(y, 1, 31);
      if (inRange(due)) out.push({ key: `SHOKYAKU:${y}`, kind: "propertyTax", title: `償却資産申告(${y}年度)`, detail: "1月1日に持っている事業用の資産(機械・器具備品など)を、置いてある市区町村に申告します。", category: "tax", due, link: "/assets/property-tax", auto: false });
    }
    // 決算の申告・納付: 期末の翌日から2か月以内
    const endMonth = f.fiscalYearStartMonth === 1 ? 12 : f.fiscalYearStartMonth - 1;
    {
      const fyEndYear = y;
      const due = monthEnd(fyEndYear, endMonth + 2);
      if (inRange(due))
        out.push({
          key: `KAKUTEI:${fyEndYear}-${pad(endMonth)}`,
          kind: "final",
          title: `決算の申告と納付(${fyEndYear}年${endMonth}月期)`,
          detail: `法人税・法人住民税・事業税${f.invoiceIssuer ? "・消費税" : "(消費税の課税事業者なら消費税も)"}を申告して納めます。決算書(貸借対照表・損益計算書など)も添えます。`,
          category: "tax",
          due,
          link: "/corporate-tax",
          auto: false,
        });
      // 中間申告: 期首から6か月たった日から2か月以内
      const interim = monthEnd(fyEndYear, endMonth + 8);
      if (inRange(interim))
        out.push({
          key: `CHUKAN:${monthOf(interim)}`,
          kind: "interim",
          title: "中間申告と納付(法人税・消費税)",
          detail: "前の期の税額によっては、期の途中で前払いの申告と納付が必要です。",
          note: "前期の法人税が20万円を超えたとき・消費税が48万円を超えたときなど",
          category: "tax",
          due: interim,
          link: "/tax/close",
          auto: false,
        });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key));
}

function statusOf(done: boolean, due: string, today: string): CalendarEvent["status"] {
  if (done) return "done";
  const left = daysBetween(today, due);
  if (left < 0) return "overdue";
  if (left <= 14) return "soon";
  return "later";
}

async function factsOf(companyId: string): Promise<CalendarFacts> {
  const [company, employees, socialInsured, residentTaxPayers, fixedAssets] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { fiscalYearStartMonth: true, withholdingSpecial: true, residentTaxSpecial: true, overtimeStartMonth: true, registrationNumber: true } }),
    prisma.staff.count({ where: { companyId, active: true } }),
    prisma.staff.count({ where: { companyId, active: true, socialInsurance: true } }),
    prisma.staff.count({ where: { companyId, active: true, residentTax: { gt: 0 } } }),
    prisma.fixedAsset.count({ where: { companyId, disposedAt: null } }),
  ]);
  return {
    fiscalYearStartMonth: company.fiscalYearStartMonth,
    withholdingSpecial: company.withholdingSpecial,
    residentTaxSpecial: company.residentTaxSpecial,
    overtimeStartMonth: company.overtimeStartMonth,
    employees,
    socialInsured,
    residentTaxPayers,
    fixedAssets,
    invoiceIssuer: !!company.registrationNumber,
  };
}

// 過去2か月(済んでいないものを拾う。済んだものも戻せるように残す)〜これから12か月
export async function getTaxCalendar(companyId: string, today = jstDateKey(new Date())) {
  const facts = await factsOf(companyId);
  const from = `${addMonth(monthOf(today), -2)}-01`;
  const endMonth = addMonth(monthOf(today), 12);
  const to = `${endMonth}-${pad(lastDay(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5))))}`;
  const drafts = buildEvents(facts, from, to);
  const [checks, remitted] = await Promise.all([
    prisma.taxCalendarCheck.findMany({ where: { companyId, key: { in: drafts.map((d) => d.key) } } }),
    prisma.taxRemittance.findMany({ where: { companyId }, select: { kind: true, period: true } }),
  ]);
  const paid = new Set(remitted.map((r) => `${r.kind}:${r.period}`));
  const events: CalendarEvent[] = drafts
    .map((d) => {
      const check = checks.find((c) => c.key === d.key);
      const done = (d.auto && paid.has(d.key)) || !!check;
      return { ...d, done, doneBy: check?.byName, status: statusOf(done, d.due, today) };
    });
  const overdue = events.filter((e) => e.status === "overdue");
  const soon = events.filter((e) => e.status === "soon");
  const findings: string[] = [];
  if (overdue.length) findings.push(`期限を過ぎて「済み」になっていないものが${overdue.length}件あります: ${overdue.slice(0, 3).map((e) => `${e.title}(${shortDate(e.due)})`).join("、")}${overdue.length > 3 ? " ほか" : ""}。済んでいれば「済み」にしてください。`);
  if (soon.length) findings.push(`2週間以内の期限が${soon.length}件あります: ${soon.slice(0, 4).map((e) => `${e.title}(${shortDate(e.due)})`).join("、")}。`);
  else if (!overdue.length) {
    const next = events.find((e) => !e.done);
    findings.push(next ? `2週間以内の期限はありません。次は ${shortDate(next.due)} の${next.title}です。` : "これから12か月の期限はありません。");
  }
  if (!facts.employees) findings.push("在籍スタッフがいないため、給与まわり(源泉所得税・年末調整・労働保険など)は出していません。");
  return { today, facts, events, findings };
}

export async function setCalendarCheck(user: { companyId: string; name: string }, input: { key?: unknown; done?: unknown }) {
  const key = String(input.key ?? "");
  const data = await getTaxCalendar(user.companyId);
  const event = data.events.find((e) => e.key === key);
  if (!event) throw new UserError("期限が見つかりません");
  if (input.done === true) await prisma.taxCalendarCheck.upsert({ where: { companyId_key: { companyId: user.companyId, key } }, update: {}, create: { companyId: user.companyId, key, byName: user.name.slice(0, 60) } });
  else {
    if (event.auto && event.done && !(await prisma.taxCalendarCheck.findUnique({ where: { companyId_key: { companyId: user.companyId, key } } })))
      throw new UserError("納付済みの記録から「済み」になっています。戻すときは「源泉徴収・納付」の画面で取り消してください");
    await prisma.taxCalendarCheck.deleteMany({ where: { companyId: user.companyId, key } });
  }
  await audit("税金・労務のカレンダー", `${event.title}を${input.done === true ? "済み" : "まだ"}にする`);
  return { ok: true };
}

// ---- スマホ・PCのカレンダー用(.ics) ----

const icsText = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
// 75オクテットごとに折り返す(UTF-8 の文字の途中では切らない)
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function toIcs(companyName: string, events: CalendarEvent[], stamp = new Date()) {
  const dt = (key: string) => key.replaceAll("-", "");
  const now = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Clerkly//Tax Calendar//JA", "CALSCALE:GREGORIAN", `X-WR-CALNAME:${icsText(`${companyName} 税金・労務の期限`)}`];
  for (const e of events.filter((x) => !x.done)) {
    const next = new Date(Date.parse(`${e.due}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.key.replace(/[^\w:~-]/g, "")}@clerkly`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dt(e.due)}`,
      `DTEND;VALUE=DATE:${dt(next)}`,
      `SUMMARY:${icsText(`【期限】${e.title}`)}`,
      `DESCRIPTION:${icsText(`${e.detail}${e.note ? `\n(${e.note})` : ""}`)}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(e.title)}`,
      "TRIGGER:-P3D",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ---- 近い期限の段取り ----

export type CalendarPlan = { summary: string; steps: { date: string; todo: string }[]; mode: "claude" | "template" };

const PREP: Record<string, string> = {
  incomeTax: "給与・報酬の源泉所得税の合計を確かめ、納付書(または e-Tax)で納める",
  residentTax: "市区町村ごとの住民税の額を確かめ、納付書(または eLTAX)で納める",
  social: "引き落とし口座の残高を確かめる",
  santei: "4〜6月の給与と出勤日数をまとめ、算定基礎届を作る",
  laborInsurance: "前年度の賃金の総額をまとめ、年度更新の申告書を作って納める",
  saburoku: "残業の上限時間などを従業員の代表と話し合い、協定書と届出を作る",
  yearEnd: "扶養控除等申告書・保険料控除申告書を配って集め、年税額を計算する",
  statutory: "源泉徴収票・支払調書と合計表を作り、税務署に出す",
  salaryReport: "市区町村ごとに給与支払報告書を作って出す",
  propertyTax: "1月1日時点の資産を確かめ、償却資産申告書を作る",
  final: "決算を締め、法人税・消費税などを計算して申告書を作る(税理士と日程を合わせる)",
  interim: "前期の税額から中間申告が必要か確かめ、必要なら申告して納める",
};

export function templatePlan(events: CalendarEvent[], today: string): Omit<CalendarPlan, "mode"> {
  const upcoming = events.filter((e) => !e.done && daysBetween(today, e.due) <= 45);
  if (!upcoming.length) return { summary: "これから45日以内に期限のある申告・納付はありません。", steps: [] };
  const overdue = upcoming.filter((e) => e.due < today);
  const steps = upcoming.map((e) => {
    // 準備は期限の5日前(すでに過ぎていれば今日)を目安に
    const prep = new Date(Date.parse(`${e.due}T00:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10);
    const date = e.due < today ? today : prep < today ? today : prep;
    return { date, todo: `${e.title}(期限 ${shortDate(e.due)}): ${PREP[e.kind] ?? "必要な書類を準備する"}` };
  });
  return {
    summary: `これから45日で期限が${upcoming.length}件あります${overdue.length ? `(うち${overdue.length}件は期限を過ぎています。まずこちらから)` : ""}。期限の5日前までに準備を始めるのが目安です。`,
    steps: steps.sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "全体のまとめ(2〜3文)" },
    steps: {
      type: "array",
      items: { type: "object", properties: { date: { type: "string", description: "YYYY-MM-DD" }, todo: { type: "string" } }, required: ["date", "todo"], additionalProperties: false },
      description: "日付順の段取り(10件まで)",
    },
  },
  required: ["summary", "steps"],
  additionalProperties: false,
};

export async function planCalendar(user: { id: string; companyId: string }) {
  const data = await getTaxCalendar(user.companyId);
  const base = templatePlan(data.events, data.today);
  const ai = await aiFor(user.companyId);
  if (!ai || !base.steps.length) return { ...base, mode: "template" as const };
  const today = data.today;
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  const upcoming = data.events.filter((e) => !e.done && daysBetween(today, e.due) <= 45);
  let result: CalendarPlan = { ...base, mode: "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の総務・経理を手伝う担当者です。近い申告・届出・納付の期限の一覧から、いつ何をするかの段取りを日付順に書いてください。",
            "期限を過ぎたものを最初に、期限の近いもの・準備に時間がかかるもの(年度更新・算定基礎・年末調整・決算)は早めに始めるようにしてください。steps の date は今日(today)以降で、その期限より前の日にしてください。",
            "渡した期限・名前以外の制度や金額は書かないでください。わかりやすい言葉で、1件1文にしてください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ today, events: upcoming.map((e) => ({ title: e.title, due: e.due, start: e.start ?? null, overdue: e.due < today, detail: e.detail, note: e.note ?? null })) }) }],
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
      ) as { summary?: unknown; steps?: unknown };
      const lastDue = upcoming.reduce((m, e) => (e.due > m ? e.due : m), today);
      const steps = (Array.isArray(raw.steps) ? raw.steps : [])
        .map((s) => s as { date?: unknown; todo?: unknown })
        .filter((s) => typeof s.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && typeof s.todo === "string" && s.todo.trim())
        .map((s) => ({ date: String(s.date) < today ? today : String(s.date) > lastDue ? lastDue : String(s.date), todo: String(s.todo).trim().slice(0, 200) }))
        .slice(0, 10)
        .sort((a, b) => a.date.localeCompare(b.date));
      const summary = typeof raw.summary === "string" ? raw.summary.trim().slice(0, 400) : "";
      if (summary && steps.length) result = { summary, steps, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: "税金・労務の段取り", tools: [], mode: `calendar-${result.mode}` } });
  return result;
}
