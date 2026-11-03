import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { relativeDue } from "@/lib/teamTasks";
import { parseDateText } from "@/lib/staffLicenses";

// 社員の健康診断: 「山田 11/20 健診 さくらクリニック 8,800円」「佐藤 受けた 再検査あり」のように1行で記録する。
// 今年まだの人・1年以上受けていない人・予約日を過ぎたのに受けた記録がない人・再検査がまだの人を知らせる。
// 健康のことは大切な個人情報なので、結果の中身(病名・数値)は記録しない。受けた日と「再検査が必要か」だけを持つ。

export const KINDS = { REGULAR: "定期健康診断", HIRING: "雇入時健康診断", STRESS: "ストレスチェック" } as const;
export type Kind = keyof typeof KINDS;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DONE_WORDS = /受けた|受診した|受診済|受けました|行った|行ってきた|済み|済んだ|終わった|完了/;
const FOLLOW_WORDS = /再検査|精密検査|要精検|二次検査|要再検|再検/;
const CLINIC = /[^\s、。,]{1,20}?(クリニック|病院|医院|診療所|健診センター|健康管理センター|検診センター|メディカルセンター)/;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const flat = (s: string) => s.replace(/\s/g, "");

export function kindOf(text: string): Kind {
  if (/ストレスチェック/.test(text)) return "STRESS";
  if (/雇入|雇い入れ|入社時|入社前/.test(text)) return "HIRING";
  return "REGULAR";
}

export type HealthDraft = { staffId: string | null; staffName: string; kind: Kind; plannedOn: string | null; doneOn: string | null; clinic: string | null; cost: number | null; followUp: boolean };

// 1行を分ける(何も保存しない)。日付が今日より後なら予約、「受けた」などがあるか今日までの日付なら受けた日
export function templateHealth(line: string, staff: { id: string; name: string }[], today: string): HealthDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const member =
    staff.find((s) => flat(t).includes(flat(s.name))) ??
    // 名字だけ(「山田 受けた」)でも、ひとりに決まればその人
    (() => {
      const head = t.split(/[\s、,]/)[0].replace(/(さん|様|くん|ちゃん)$/, "");
      const hits = head.length >= 2 ? staff.filter((s) => flat(s.name).startsWith(head)) : [];
      return hits.length === 1 ? hits[0] : null;
    })();
  const noMoney = t.replace(/\d[\d,]*\s*円/g, " ");
  let date = parseDateText(noMoney) ?? relativeDue(noMoney, today);
  // 「10/2」のように年がないとき、期限の読み方だと来年になるが、健康診断なら半年より先は今年の過ぎた日とみる
  if (date && !/\d{4}/.test(noMoney) && daysBetween(today, date) > 180) date = `${Number(date.slice(0, 4)) - 1}${date.slice(4)}`;
  const done = DONE_WORDS.test(t);
  const doneOn = done ? (date && date <= today ? date : today) : date && date < today ? date : null;
  const plannedOn = !doneOn && date ? date : null;
  const costM = t.match(/(\d[\d,]*)\s*円/);
  const cost = costM ? Number(costM[1].replace(/,/g, "")) : null;
  const followUp = FOLLOW_WORDS.test(t) && !/再検査(は)?(なし|無し|なかった|不要)|異常なし/.test(t);
  return {
    staffId: member?.id ?? null,
    staffName: member?.name ?? "",
    kind: kindOf(t),
    plannedOn,
    doneOn,
    clinic: t.match(CLINIC)?.[0] ?? null,
    cost: cost && cost > 0 && cost <= 1_000_000 ? cost : null,
    followUp,
  };
}

const activeStaff = (companyId: string) => prisma.staff.findMany({ where: { companyId, active: true }, select: { id: true, name: true, hireDate: true }, orderBy: { name: "asc" } });

export async function parseHealth(companyId: string, text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("健康診断のことを書いてください(例: 山田 11/20 健診 さくらクリニック 8,800円)");
  return templateHealth(t, await activeStaff(companyId), jstDateKey(new Date()));
}

const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";

export async function saveHealth(user: { companyId: string; name: string; role: string }, raw: Record<string, unknown>, id?: string) {
  if (!canManage(user.role)) throw new UserError("健康診断の記録は管理者・経理担当がします");
  // 再検査を受けた(今日)だけを記録する
  if (id && raw.action === "followUpDone") {
    const { count } = await prisma.healthCheck.updateMany({ where: { id, companyId: user.companyId, followUp: true }, data: { followUpDoneOn: jstDateKey(new Date()) } });
    if (!count) throw new UserError("見つかりません");
    return prisma.healthCheck.findUniqueOrThrow({ where: { id } });
  }
  const date = (v: unknown, label: string) => {
    const s = String(v ?? "").trim();
    if (!s) return null;
    if (!DATE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new UserError(`${label}を正しく入れてください`);
    return s;
  };
  const plannedOn = date(raw.plannedOn, "予約日");
  const doneOn = date(raw.doneOn, "受けた日");
  if (doneOn && doneOn > jstDateKey(new Date())) throw new UserError("受けた日が今日より後になっています。先の日なら予約日に入れてください");
  const followUpDoneOn = date(raw.followUpDoneOn, "再検査を受けた日");
  const costRaw = String(raw.cost ?? "").replace(/[,円\s]/g, "");
  if (costRaw && !/^\d{1,7}$/.test(costRaw)) throw new UserError("費用を正しく入れてください");
  const kind: Kind = raw.kind === "HIRING" || raw.kind === "STRESS" ? raw.kind : "REGULAR";
  const common = {
    kind,
    plannedOn,
    doneOn,
    clinic: String(raw.clinic ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null,
    cost: costRaw ? Number(costRaw) : null,
    followUp: raw.followUp === true,
    followUpDoneOn: raw.followUp === true ? followUpDoneOn : null,
    note: String(raw.note ?? "").trim().slice(0, 200) || null,
  };
  if (id) {
    const row = await prisma.healthCheck.findFirst({ where: { id, companyId: user.companyId } });
    if (!row) throw new UserError("見つかりません");
    if (row.journalEntryId && (common.cost !== row.cost || common.doneOn !== row.doneOn)) throw new UserError("費用はもう仕訳しました。費用・受けた日を直すときは、先に仕訳帳で仕訳を取り消してください");
    const day = doneOn ?? plannedOn;
    return prisma.healthCheck.update({ where: { id }, data: { ...common, year: day ? Number(day.slice(0, 4)) : row.year } });
  }
  const staffId = String(raw.staffId ?? "");
  const member = staffId ? await prisma.staff.findFirst({ where: { id: staffId, companyId: user.companyId }, select: { id: true, name: true } }) : null;
  if (!member) throw new UserError("受ける人を選んでください");
  if (!plannedOn && !doneOn) throw new UserError("予約日か受けた日を入れてください");
  const day = (doneOn ?? plannedOn)!;
  const year = Number(day.slice(0, 4));
  // 同じ人・同じ種類・同じ年で、まだ受けていない予約があれば、それを書きかえる(予約→受けた)
  const open = await prisma.healthCheck.findFirst({ where: { companyId: user.companyId, staffId: member.id, kind, year, doneOn: null }, orderBy: { createdAt: "desc" } });
  if (open) return prisma.healthCheck.update({ where: { id: open.id }, data: { ...common, plannedOn: plannedOn ?? open.plannedOn, clinic: common.clinic ?? open.clinic, cost: common.cost ?? open.cost } });
  return prisma.healthCheck.create({ data: { companyId: user.companyId, staffId: member.id, staffName: member.name, year, ...common, createdByName: user.name } });
}

export async function deleteHealth(user: { companyId: string; role: string }, id: string) {
  if (!canManage(user.role)) throw new UserError("健康診断の記録は管理者・経理担当がします");
  const row = await prisma.healthCheck.findFirst({ where: { id, companyId: user.companyId }, select: { journalEntryId: true } });
  if (row?.journalEntryId) throw new UserError("費用はもう仕訳しました。消すときは、先に仕訳帳で仕訳を取り消してください");
  const { count } = await prisma.healthCheck.deleteMany({ where: { id, companyId: user.companyId } });
  if (!count) throw new UserError("見つかりません");
}

export const STATES = { DONE: "受けた", PLANNED: "予約済み", PASSED: "予約日を過ぎた", NOT_YET: "今年まだ", DUE: "1年以上受けていない・記録なし", MISSED: "受けた記録なし" } as const;
export type State = keyof typeof STATES;

// 画面: 在籍している人ごとの今年の定期健康診断・ストレスチェックの状態、再検査がまだの人、その年の記録
export async function listHealth(companyId: string, year: number) {
  const today = jstDateKey(new Date());
  const [staff, rows] = await Promise.all([activeStaff(companyId), prisma.healthCheck.findMany({ where: { companyId }, orderBy: [{ year: "desc" }, { doneOn: "desc" }, { plannedOn: "desc" }] })]);
  const people = staff.map((s) => {
    const mine = rows.filter((r) => r.staffId === s.id);
    const regular = mine.filter((r) => r.kind === "REGULAR" || r.kind === "HIRING");
    const thisYear = regular.filter((r) => r.year === year);
    const done = thisYear.find((r) => r.doneOn);
    const plan = thisYear.find((r) => !r.doneOn && r.plannedOn);
    const lastDone = regular.map((r) => r.doneOn).filter((d): d is string => !!d).sort().pop() ?? null;
    // 入社して1年たっていない人で、雇入時の健診を受けていれば「1年以上」にはしない
    const hired = s.hireDate ? s.hireDate.toISOString().slice(0, 10) : null;
    const state: State = done ? "DONE" : year < Number(today.slice(0, 4)) ? "MISSED" : plan ? (plan.plannedOn! < today ? "PASSED" : "PLANNED") : !lastDone ? (hired && daysBetween(hired, today) < 365 ? "NOT_YET" : "DUE") : daysBetween(lastDone, today) > 365 ? "DUE" : "NOT_YET";
    const stress = mine.find((r) => r.kind === "STRESS" && r.year === year);
    return {
      staffId: s.id,
      name: s.name,
      state,
      doneOn: done?.doneOn ?? null,
      plannedOn: plan?.plannedOn ?? null,
      clinic: (done ?? plan)?.clinic ?? null,
      lastDone,
      stress: stress?.doneOn ? "受けた" : stress?.plannedOn ? `予約 ${stress.plannedOn}` : null,
      recordId: (done ?? plan)?.id ?? null,
    };
  });
  const followUps = rows.filter((r) => r.followUp && !r.followUpDoneOn && staff.some((s) => s.id === r.staffId)).map((r) => ({ id: r.id, staffId: r.staffId, name: r.staffName, kind: r.kind, doneOn: r.doneOn, days: r.doneOn ? daysBetween(r.doneOn, today) : null }));
  const records = rows.filter((r) => r.year === year);
  const counts = Object.fromEntries((Object.keys(STATES) as State[]).map((k) => [k, people.filter((p) => p.state === k).length])) as Record<State, number>;
  return { year, today, people, followUps, records, counts, cost: records.reduce((s, r) => s + (r.doneOn ? (r.cost ?? 0) : 0), 0), started: rows.length > 0 };
}

// やることリスト: 予約日を過ぎたのに受けた記録がない・再検査がまだ・1年以上受けていない(記録をつけはじめた会社だけ)
export async function countHealthTodos(companyId: string) {
  const d = await listHealth(companyId, Number(jstDateKey(new Date()).slice(0, 4)));
  if (!d.started) return { passed: 0, followUps: 0, due: 0, total: 0 };
  const passed = d.counts.PASSED;
  const due = d.counts.DUE;
  return { passed, followUps: d.followUps.length, due, total: passed + d.followUps.length + due };
}

// ---- 従業員が自分で入れる ----

const ownStaff = (me: { id: string; companyId: string }) => prisma.staff.findFirst({ where: { companyId: me.companyId, userId: me.id, active: true }, select: { id: true, name: true } });

// 自分の健康診断: 今年の状態・自分の記録(この2年)・再検査がまだのもの。費用は見せない
export async function myHealth(me: { id: string; companyId: string }) {
  const s = await ownStaff(me);
  if (!s) return { linked: false as const };
  const year = Number(jstDateKey(new Date()).slice(0, 4));
  const d = await listHealth(me.companyId, year);
  const p = d.people.find((x) => x.staffId === s.id) ?? null;
  const rows = await prisma.healthCheck.findMany({ where: { companyId: me.companyId, staffId: s.id, year: { gte: year - 1 } }, orderBy: [{ year: "desc" }, { createdAt: "desc" }] });
  return {
    linked: true as const,
    year,
    today: d.today,
    state: p?.state ?? "NOT_YET",
    stateLabel: STATES[(p?.state ?? "NOT_YET") as State],
    lastDone: p?.lastDone ?? null,
    records: rows.map((r) => ({ id: r.id, kind: r.kind, kindLabel: KINDS[r.kind as Kind] ?? r.kind, plannedOn: r.plannedOn, doneOn: r.doneOn, clinic: r.clinic, followUp: r.followUp, followUpDoneOn: r.followUpDoneOn })),
  };
}

// 自分で入れる: { action: "plan", kind, plannedOn, clinic } / { action: "done", kind, doneOn, clinic, followUp } / { action: "followUpDone", id }
export async function saveOwnHealth(me: { id: string; name: string; companyId: string }, raw: Record<string, unknown>) {
  const s = await ownStaff(me);
  if (!s) throw new UserError("あなたのスタッフ登録が見つかりません。総務に、ログインとスタッフのひも付けを頼んでください");
  const today = jstDateKey(new Date());
  if (raw.action === "followUpDone") {
    const { count } = await prisma.healthCheck.updateMany({ where: { id: String(raw.id ?? ""), companyId: me.companyId, staffId: s.id, followUp: true }, data: { followUpDoneOn: today } });
    if (!count) throw new UserError("見つかりません");
    return { ok: true };
  }
  const kind: Kind = raw.kind === "HIRING" || raw.kind === "STRESS" ? raw.kind : "REGULAR";
  const day = String((raw.action === "done" ? raw.doneOn : raw.plannedOn) ?? "").trim();
  if (!DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) throw new UserError(raw.action === "done" ? "受けた日を入れてください" : "予約した日を入れてください");
  if (raw.action === "done" && day > today) throw new UserError("受けた日が今日より後になっています");
  if (raw.action !== "done" && day < today) throw new UserError("予約した日が過ぎています。受けたなら「受けた」で入れてください");
  const clinic = String(raw.clinic ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || null;
  const year = Number(day.slice(0, 4));
  const open = await prisma.healthCheck.findFirst({ where: { companyId: me.companyId, staffId: s.id, kind, year, doneOn: null }, orderBy: { createdAt: "desc" } });
  if (raw.action === "done") {
    const data = { doneOn: day, clinic: clinic ?? open?.clinic ?? null, followUp: raw.followUp === true };
    if (open) return prisma.healthCheck.update({ where: { id: open.id }, data, select: { id: true } });
    return prisma.healthCheck.create({ data: { companyId: me.companyId, staffId: s.id, staffName: s.name, year, kind, ...data, createdByName: me.name }, select: { id: true } });
  }
  if (open) return prisma.healthCheck.update({ where: { id: open.id }, data: { plannedOn: day, clinic: clinic ?? open.clinic }, select: { id: true } });
  return prisma.healthCheck.create({ data: { companyId: me.companyId, staffId: s.id, staffName: s.name, year, kind, plannedOn: day, clinic, createdByName: me.name }, select: { id: true } });
}
