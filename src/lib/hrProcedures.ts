import Anthropic from "@anthropic-ai/sdk";
import { inventedNumbers } from "@/lib/ai/numberGuard";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aiFor } from "@/lib/ai/access";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { audit } from "@/lib/audit";
import type { LaborDefaults, Profile } from "@/lib/staffRecords";

// 入社・退職の手続きナビ: 入社日・退職日から、社会保険・雇用保険の届出、住民税、源泉徴収票、備品の返却などを
// 期限つきのチェックリストにする。データでわかるもの(振込先の登録・備品の返却・ログインの停止など)は自動で「済み」。
// 本人に送る案内文(用意してもらうもの・返してもらうもの・会社から渡すもの)は、決まったひな形か AI で作る。
// 期限は法律の一般的な期限の目安。土日祝の扱いや個別の事情は年金事務所・ハローワーク・社労士に確かめる前提。

const MODEL = process.env.ANTHROPIC_ASSISTANT_MODEL || "claude-opus-5-5";
const DAILY_LIMIT = Number(process.env.ASSISTANT_DAILY_LIMIT || 100);

const HIRE_BEFORE = 60; // 入社日の60日前から
const HIRE_AFTER = 90; // 入社日から90日後まで表示
const RETIRE_BEFORE = 60;
const RETIRE_AFTER = 60;

export type ProcedureKind = "hire" | "retire";
export type ProcedureTask = {
  key: string;
  label: string;
  detail: string;
  due: string | null; // YYYY-MM-DD(期限がないものは null)
  dueNote?: string; // 期限の説明(「入社日から5日以内」など)
  link?: string;
  auto: boolean; // データから自動で判定する項目
  done: boolean;
  doneBy?: string;
  status: "done" | "overdue" | "soon" | "later" | "none";
};
export type ProcedureCase = {
  staffId: string;
  name: string;
  kind: ProcedureKind;
  date: string; // 入社日 / 退職日
  tasks: ProcedureTask[];
  openLoans: string[]; // 貸し出し中の備品(退職のとき)
  remaining: number;
  overdue: number;
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(key: string, days: number) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}
// 翌月10日
export function nextMonth10(key: string) {
  const [y, m] = key.split("-").map(Number);
  return ymd(new Date(Date.UTC(y, m, 10)));
}
// 1か月後の同じ日(なければ月末)の前日まで=「1か月以内」
export function withinOneMonth(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return ymd(new Date(Date.UTC(y, m, Math.min(d, last))));
}
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const shortDate = (key: string) => `${Number(key.slice(5, 7))}/${Number(key.slice(8, 10))}`;
export const jpDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
};

function statusOf(done: boolean, due: string | null, today: string): ProcedureTask["status"] {
  if (done) return "done";
  if (!due) return "none";
  const left = daysBetween(today, due);
  if (left < 0) return "overdue";
  if (left <= 7) return "soon";
  return "later";
}

const asObject = <T,>(v: Prisma.JsonValue | null): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as unknown as T) : ({} as T));

type StaffRow = {
  id: string;
  name: string;
  active: boolean;
  hireDate: Date | null;
  socialInsurance: boolean;
  employmentInsurance: boolean;
  taxColumn: string;
  residentTax: number;
  payeeAccount: Prisma.JsonValue | null;
  profile: Prisma.JsonValue | null;
  userId: string | null;
};
type Facts = { openLoans: string[]; memberActive: boolean | null };
// autoDone: データから見て済んでいるか(auto の項目だけ)
type BuiltTask = Omit<ProcedureTask, "done" | "status" | "doneBy"> & { autoDone?: boolean };

// 1人分の手続き(チェック状態をつける前)
export function buildTasks(s: StaffRow, kind: ProcedureKind, date: string, facts: Facts): BuiltTask[] {
  const profile = asObject<Profile>(s.profile);
  const tasks: BuiltTask[] = [];
  if (kind === "hire") {
    tasks.push({ key: "notice", label: "労働条件通知書を渡す", detail: "賃金・勤務時間・休日などの条件を書面で渡します(雇うときに必ず必要です)。", due: date, dueNote: "入社日まで", link: `/staff-records/${s.id}/notice`, auto: false });
    const rosterOk = !!(profile.kana && profile.birthDate && profile.address);
    tasks.push({ key: "roster", label: "労働者名簿に記入する", detail: rosterOk ? "ふりがな・生年月日・住所が入っています。" : "ふりがな・生年月日・住所を入れてください。", due: date, dueNote: "入社日まで", link: "/staff-records", auto: true, autoDone: rosterOk });
    if (s.socialInsurance)
      tasks.push({ key: "shahoIn", label: "健康保険・厚生年金の資格取得届", detail: "年金事務所(電子申請も可)に出します。マイナンバー(または基礎年金番号)と、扶養する家族がいればその情報も必要です。", due: addDays(date, 4), dueNote: "入社日から5日以内", auto: false });
    if (s.employmentInsurance)
      tasks.push({ key: "koyoIn", label: "雇用保険の資格取得届", detail: "ハローワーク(電子申請も可)に出します。前の会社で雇用保険に入っていた人は、雇用保険被保険者証(番号)を受け取ってください。", due: nextMonth10(date), dueNote: "入社した月の翌月10日まで", auto: false });
    if (s.taxColumn === "KOU") tasks.push({ key: "fuyo", label: "扶養控除等申告書を受け取る", detail: "源泉所得税を甲欄で計算するために必要です。会社で保管します。", due: null, dueNote: "最初の給与の計算まで", auto: false });
    if (Number(date.slice(5, 7)) > 1)
      tasks.push({ key: "prevSlip", label: "前の会社の源泉徴収票を受け取る", detail: "今年ほかの会社から給与を受けていた人は、年末調整で合算するために必要です(いなければ「済み」に)。", due: null, dueNote: "年末調整まで", link: "/year-end", auto: false });
    tasks.push({ key: "residentIn", label: "住民税の特別徴収を引き継ぐか確かめる", detail: "前の会社から「給与所得者異動届出書」が届いたら市区町村に出し、毎月の住民税を給与の設定に入れます(なければ「済み」に)。", due: null, link: "/payroll", auto: false });
    const payeeOk = !!(s.payeeAccount && typeof s.payeeAccount === "object" && Object.keys(s.payeeAccount as object).length);
    tasks.push({ key: "payee", label: "給与の振込先を登録する", detail: payeeOk ? "振込先が登録されています。" : "最初の給料日までに、振込先の口座を登録してください。", due: null, dueNote: "最初の給料日まで", link: "/transfers", auto: true, autoDone: payeeOk });
  } else {
    if (s.socialInsurance)
      tasks.push({ key: "shahoOut", label: "健康保険・厚生年金の資格喪失届", detail: "年金事務所(電子申請も可)に出します。健康保険の資格確認書(保険証)を持っていれば回収して添えます。", due: addDays(date, 5), dueNote: "退職日の翌日から5日以内", auto: false });
    if (s.employmentInsurance)
      tasks.push({ key: "koyoOut", label: "雇用保険の資格喪失届・離職証明書", detail: "ハローワークに出します。本人が離職票を希望するときは離職証明書も付けます(59歳以上は希望がなくても必要)。", due: addDays(date, 11), dueNote: "退職日の翌々日から10日以内", auto: false });
    if (s.residentTax > 0)
      tasks.push({ key: "residentOut", label: "住民税の給与所得者異動届出書", detail: "住んでいる市区町村に出します。残りの住民税を最後の給与からまとめて引くか(一括徴収)、本人が自分で払うか(普通徴収)を決めます。", due: nextMonth10(date), dueNote: "退職した月の翌月10日まで", auto: false });
    tasks.push({ key: "slip", label: "源泉徴収票を本人に渡す", detail: "退職した年の給与の源泉徴収票を渡します(次の会社の年末調整や確定申告で使います)。", due: withinOneMonth(date), dueNote: "退職日から1か月以内", link: "/year-end", auto: false });
    tasks.push({ key: "lastPay", label: "最後の給与と有給の残りを確かめる", detail: "退職日までの勤務と有給休暇の消化を確かめて、最後の給与を計算します。", due: date, dueNote: "退職日まで", link: "/payroll", auto: false });
    const loansOk = facts.openLoans.length === 0;
    tasks.push({ key: "equipment", label: "貸している備品の返却", detail: loansOk ? "貸し出し中の備品はありません。" : `貸し出し中: ${facts.openLoans.join("、")}`, due: date, dueNote: "退職日まで", link: "/equipment", auto: true, autoDone: loansOk });
    if (facts.memberActive !== null) {
      const off = facts.memberActive === false;
      tasks.push({ key: "account", label: "ログインを止める", detail: off ? "ログインは止めてあります。" : "このシステムのログインを使えないようにします(ユーザー管理)。", due: addDays(date, 1), dueNote: "退職日の翌日", link: "/users", auto: true, autoDone: off });
    }
    tasks.push({ key: "inactive", label: "スタッフを「退職」にする", detail: s.active ? "シフト・タイムカード・給与の一覧から外れます。" : "退職にしてあります。", due: addDays(date, 1), dueNote: "退職日の翌日", link: "/shifts", auto: true, autoDone: !s.active });
  }
  return tasks;
}

export async function getHrProcedures(companyId: string, today = jstDateKey(new Date())) {
  const staff = await prisma.staff.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, active: true, hireDate: true, socialInsurance: true, employmentInsurance: true, taxColumn: true, residentTax: true, payeeAccount: true, profile: true, userId: true },
  });
  const targets: { s: StaffRow; kind: ProcedureKind; date: string }[] = [];
  for (const s of staff) {
    const retire = asObject<Profile>(s.profile).retireDate;
    if (retire) {
      const d = daysBetween(today, retire);
      if (d >= -RETIRE_AFTER && d <= RETIRE_BEFORE) {
        targets.push({ s, kind: "retire", date: retire });
        continue;
      }
    }
    if (s.hireDate && s.active) {
      const hire = jstDateKey(s.hireDate);
      const d = daysBetween(today, hire);
      if (d >= -HIRE_AFTER && d <= HIRE_BEFORE) targets.push({ s, kind: "hire", date: hire });
    }
  }
  const ids = targets.map((t) => t.s.id);
  const userIds = targets.map((t) => t.s.userId).filter((u): u is string => !!u);
  const names = targets.filter((t) => t.kind === "retire").map((t) => t.s.name);
  const [checks, loans, members] = await Promise.all([
    prisma.hrProcedureCheck.findMany({ where: { companyId, staffId: { in: ids } } }),
    names.length || userIds.length
      ? prisma.equipmentLoan.findMany({
          where: { returnedAt: null, equipment: { companyId }, OR: [{ borrowerName: { in: names } }, ...(userIds.length ? [{ userId: { in: userIds } }] : [])] },
          select: { borrowerName: true, userId: true, equipment: { select: { name: true } } },
        })
      : Promise.resolve([]),
    userIds.length ? prisma.companyMember.findMany({ where: { companyId, userId: { in: userIds } }, select: { userId: true, active: true } }) : Promise.resolve([]),
  ]);
  const cases: ProcedureCase[] = targets.map(({ s, kind, date }) => {
    const openLoans = loans.filter((l) => l.borrowerName === s.name || (s.userId && l.userId === s.userId)).map((l) => l.equipment.name);
    const member = s.userId ? members.find((m) => m.userId === s.userId) : undefined;
    const tasks = buildTasks(s, kind, date, { openLoans, memberActive: member ? member.active : null }).map((t) => {
      const check = checks.find((c) => c.staffId === s.id && c.key === t.key);
      const { autoDone, ...rest } = t;
      const done = t.auto ? autoDone === true : !!check;
      return { ...rest, done, doneBy: !t.auto && check ? check.byName : undefined, status: statusOf(done, t.due, today) } satisfies ProcedureTask;
    });
    return { staffId: s.id, name: s.name, kind, date, tasks, openLoans, remaining: tasks.filter((t) => !t.done).length, overdue: tasks.filter((t) => t.status === "overdue").length };
  });
  // 期限切れの多い順 → 日付の近い順
  cases.sort((a, b) => b.overdue - a.overdue || Math.abs(daysBetween(today, a.date)) - Math.abs(daysBetween(today, b.date)));
  const open = cases.flatMap((c) => c.tasks.filter((t) => !t.done).map((t) => ({ ...t, name: c.name, kind: c.kind })));
  const overdue = open.filter((t) => t.status === "overdue");
  const soon = open.filter((t) => t.status === "soon");
  const findings: string[] = [];
  if (!cases.length) findings.push("いま手続きが必要な入社・退職はありません(労働者名簿に入社日・退職日を入れると、ここに出ます)。");
  else {
    findings.push(`入社${cases.filter((c) => c.kind === "hire").length}人・退職${cases.filter((c) => c.kind === "retire").length}人の手続きがあり、残りは${open.length}件です。`);
    if (overdue.length) findings.push(`期限を過ぎた手続きが${overdue.length}件あります: ${overdue.slice(0, 3).map((t) => `${t.name}さんの${t.label}`).join("、")}${overdue.length > 3 ? " ほか" : ""}。`);
    if (soon.length) findings.push(`1週間以内に期限が来る手続きが${soon.length}件あります: ${soon.slice(0, 3).map((t) => `${t.name}さんの${t.label}(${shortDate(t.due!)}まで)`).join("、")}。`);
  }
  return { today, cases, findings };
}

export async function setProcedureCheck(user: { companyId: string; name: string }, input: { staffId?: unknown; key?: unknown; done?: unknown }) {
  const staffId = String(input.staffId ?? "");
  const key = String(input.key ?? "");
  const data = await getHrProcedures(user.companyId);
  const c = data.cases.find((x) => x.staffId === staffId);
  const task = c?.tasks.find((t) => t.key === key);
  if (!c || !task) throw new UserError("手続きが見つかりません");
  if (task.auto) throw new UserError("この項目はデータから自動で判定します。リンク先の画面で登録してください");
  if (input.done === true) {
    await prisma.hrProcedureCheck.upsert({ where: { staffId_key: { staffId, key } }, update: {}, create: { companyId: user.companyId, staffId, key, byName: user.name.slice(0, 60) } });
  } else {
    await prisma.hrProcedureCheck.deleteMany({ where: { companyId: user.companyId, staffId, key } });
  }
  await audit("入社・退職の手続き", `${c.name}: ${task.label}を${input.done === true ? "済み" : "まだ"}にする`);
  return { ok: true };
}

// ---- 本人に送る案内 ----

export type Guide = { subject: string; body: string; mode: "claude" | "template" };

export function templateGuide(company: string, c: ProcedureCase, s: { socialInsurance: boolean; employmentInsurance: boolean; taxColumn: string }, defaults: LaborDefaults): Omit<Guide, "mode"> {
  const lines: string[] = [];
  if (c.kind === "hire") {
    lines.push(`${c.name}さん`, "", `${company}へようこそ。入社(${jpDate(c.date)})にあたって、手続きに使う次のものをご用意ください。`, "");
    lines.push("【ご用意いただくもの】");
    if (s.socialInsurance || s.employmentInsurance) lines.push("・マイナンバー(個人番号)がわかるもの");
    if (s.socialInsurance) lines.push("・基礎年金番号がわかるもの(基礎年金番号通知書・年金手帳など)", "・扶養する家族がいる場合は、その家族の氏名・生年月日・マイナンバー");
    if (s.employmentInsurance) lines.push("・雇用保険被保険者証(前の会社で雇用保険に入っていた方)");
    if (Number(c.date.slice(5, 7)) > 1) lines.push("・前の会社の源泉徴収票(今年、ほかの会社から給与を受けた方)");
    lines.push("・給与の振込先(銀行名・支店名・口座の種類・口座番号・名義)");
    if (s.taxColumn === "KOU") lines.push("・扶養控除等申告書(用紙は会社からお渡しします。記入して提出してください)");
    lines.push("", "【会社からお渡しするもの】", "・労働条件通知書(お給料・勤務時間・休日などの条件)");
    if (defaults.payDay) lines.push("", `お給料は${defaults.payDay}にお支払いします。`);
    lines.push("", "わからないことがあれば、いつでも聞いてください。当日お会いできるのを楽しみにしています。");
    return { subject: `入社の手続きのご案内(${company})`, body: lines.join("\n") };
  }
  lines.push(`${c.name}さん`, "", `これまで本当にありがとうございました。退職(${jpDate(c.date)})にあたって、手続きのご案内をお送りします。`, "");
  lines.push("【返していただくもの】");
  if (s.socialInsurance) lines.push("・健康保険の資格確認書(保険証をお持ちの場合は保険証)。ご家族の分も含みます");
  for (const name of c.openLoans) lines.push(`・${name}`);
  lines.push("・社員証・鍵など、会社からお渡ししているもの");
  lines.push("", "【会社からお渡しするもの】", "・源泉徴収票(退職後1か月以内。次の会社に出すか、確定申告で使います)");
  if (s.employmentInsurance) lines.push("・離職票(ご希望の方。ハローワークの手続きのあとにお送りします。失業給付の申し込みに使います)");
  if (s.socialInsurance) lines.push("", "【健康保険について】", "退職日の翌日から会社の健康保険は使えなくなります。国民健康保険に入るか、任意継続・ご家族の扶養に入るかをお選びください。");
  lines.push("", "最後のお給料は、退職日までの勤務分を計算してお支払いします。");
  if (defaults.payDay) lines.push(`(お支払い日: ${defaults.payDay})`);
  lines.push("", "ご不明な点があれば、お気軽にお問い合わせください。");
  return { subject: `退職の手続きのご案内(${company})`, body: lines.join("\n") };
}

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string", description: "件名(40文字以内)" },
    body: { type: "string", description: "本文(宛名から結びまで。改行は \\n)" },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

export async function draftGuide(user: { id: string; companyId: string }, input: { staffId?: unknown; notes?: unknown; useAi?: unknown }) {
  const staffId = String(input.staffId ?? "");
  const notes = String(input.notes ?? "").trim().slice(0, 1000);
  const data = await getHrProcedures(user.companyId);
  const c = data.cases.find((x) => x.staffId === staffId);
  if (!c) throw new UserError("手続き中のスタッフが見つかりません");
  const [company, s] = await Promise.all([
    prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true, laborDefaults: true } }),
    prisma.staff.findFirstOrThrow({ where: { id: staffId, companyId: user.companyId }, select: { socialInsurance: true, employmentInsurance: true, taxColumn: true } }),
  ]);
  const base = templateGuide(company.name, c, s, asObject<LaborDefaults>(company.laborDefaults));
  const ai = input.useAi === true ? await aiFor(user.companyId) : null;
  if (input.useAi === true && !ai) throw new UserError("AIが使えません(AIの設定を確かめてください)");
  if (!ai) return { ...base, mode: "template" as const };

  const today = jstDateKey(new Date());
  if ((await prisma.assistantLog.count({ where: { companyId: user.companyId, createdAt: { gte: new Date(`${today}T00:00:00+09:00`) } } })) >= DAILY_LIMIT) throw new UserError(`AIの利用は1日${DAILY_LIMIT}回までです。明日またお試しください`);
  let result: Guide = { ...base, mode: "template" };
  try {
    const response = await ai.beta.messages.create({
      model: MODEL,
      max_tokens: 3000,
      system: [
        {
          type: "text",
          text: [
            "あなたは小さな会社の総務担当者です。入社する人・退職する人に送る、手続きの案内メールを書きます。",
            "渡したひな形の【】の項目(用意してもらうもの・返してもらうもの・会社から渡すもの)は、すべて残し、増やさないでください。日付・お支払い日もひな形のとおりにしてください。",
            "notes に書かれた会社の事情や本人への気持ちを、あたたかく、読みやすい言葉で反映してください。法律の期限や制度など、渡していない事実は書かないでください。",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: JSON.stringify({ kind: c.kind === "hire" ? "入社" : "退職", company: company.name, name: c.name, date: c.date, notes: notes || null, template: base }) }],
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
      ) as { subject?: unknown; body?: unknown };
      const subject = typeof raw.subject === "string" ? raw.subject.replace(/[\r\n]/g, " ").trim().slice(0, 80) : "";
      const body = typeof raw.body === "string" ? raw.body.trim().slice(0, 4000) : "";
      // 用意・返却の項目がひな形と同じだけ残っているときだけ使う
      const bullets = (t: string) => t.split("\n").filter((l) => l.trim().startsWith("・")).length;
      // 日付・金額はひな形・入力にあるものだけ
      const source = `${base.subject} ${base.body} ${c.date} ${notes}`;
      if (subject && body && bullets(body) >= bullets(base.body) && !inventedNumbers(`${subject} ${body}`, source).length) result = { subject, body, mode: "claude" };
    }
  } catch (error) {
    if (!(error instanceof Anthropic.APIError) && !(error instanceof SyntaxError)) throw error;
  }
  await prisma.assistantLog.create({ data: { companyId: user.companyId, userId: user.id, question: `${c.kind === "hire" ? "入社" : "退職"}の案内文`, tools: [], mode: `hr-guide-${result.mode}` } });
  return result;
}

// やることリスト用: 期限を過ぎた・7日以内の手続き(済んでいないもの)の数
export async function countHrProcedureAlerts(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const { cases } = await getHrProcedures(companyId, today);
  const open = cases.flatMap((c) => c.tasks).filter((t) => !t.done && t.due && daysBetween(today, t.due) <= 7);
  return { count: open.length, overdue: open.filter((t) => t.due! < today).length };
}
