import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { matchMember, relativeDue, stripDue } from "@/lib/teamTasks";

// 鍵・入館証・貸出品の貸し出し簿: 「会議室の鍵を山田さんに 金曜まで」のように1行で書くと、貸したもの・相手・返す日に分けて記録する。
// 返してもらったら「返してもらった」を押す。返す日を過ぎたものは上に出す。

type Member = { id: string; name: string; email: string | null };
export type LendingDraft = { item: string; borrowerId: string | null; borrowerName: string; lentOn: string; dueOn: string | null; note: string | null };

const HONORIFIC = /(さん|様|さま|くん|君|ちゃん|部長|課長|係長|主任|社長)/;

export function templateLending(line: string, today: string, users: Member[]): LendingDraft {
  const t = line.normalize("NFKC").replace(/\s+/g, " ").trim();
  const dueText = t.match(/(.{0,16}?)(?:まで|までに|に返す|に返却|返却予定|返す予定|今日中|本日中)/)?.[0] ?? (/(返す|返却)/.test(t) ? t : "");
  let dueOn = dueText ? relativeDue(dueText, today) : null;
  if (dueOn && dueOn < today) dueOn = null;
  // 相手: 社内の人の名前が入っていればその人、なければ「○○さんに」「○○に貸した」
  const flat = t.replace(/\s/g, "");
  const member = users.find((u) => flat.includes(u.name.replace(/\s/g, ""))) ?? null;
  const nameM = t.match(new RegExp(`([^\\s、。をにのが]{1,12}?)${HONORIFIC.source}\\s?(?:に|へ|が|の|$|\\s)`)) ?? t.match(/([^\s、。をのが]{1,12}?)に(?=\s?(?:貸|渡))/);
  const byFamily = !member && nameM ? matchMember(users, nameM[1]) : null;
  const who = member ?? byFamily;
  const borrowerName = who?.name ?? nameM?.[1] ?? "";
  // 「さくら商事の田中様」→ 会社名はメモに
  const orgM = !who && nameM ? t.slice(0, nameM.index).match(/([^\s、。をにが]{2,20})の$/) : null;
  let rest = t;
  if (orgM) rest = rest.replace(orgM[0], " ");
  if (member) rest = rest.replace(member.name, " ").replace(member.name.replace(/\s/g, ""), " ");
  if (nameM) rest = rest.replace(nameM[0], " ");
  rest = rest.replace(/(返却予定|返す予定|返します|返す|返却|貸し出し|貸出|貸した|貸します|貸す|渡した|渡します|お借りします|借りた|借ります)/g, " ");
  rest = stripDue(rest)
    .replace(/(今日中|本日中)/g, " ")
    .replace(new RegExp(`^${HONORIFIC.source}|\\s${HONORIFIC.source}(?=\\s|$)`, "g"), " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s、。をでのにが]+|[\s、。をでのにがは]+$/g, "")
    .trim();
  const item = rest.slice(0, 40);
  return { item, borrowerId: who?.id ?? null, borrowerName: borrowerName.slice(0, 30), lentOn: today, dueOn, note: orgM ? orgM[1].slice(0, 100) : null };
}

const members = (companyId: string) => prisma.user.findMany({ where: { companyId, active: true, role: { not: "ADVISOR" } }, select: { id: true, name: true, email: true }, orderBy: { createdAt: "asc" } });

export async function parseLending(companyId: string, text: string) {
  const t = String(text ?? "").trim().slice(0, 200);
  if (!t) throw new UserError("貸したものと相手を書いてください(例: 会議室の鍵を山田さんに 金曜まで)");
  return templateLending(t, jstDateKey(new Date()), await members(companyId));
}

const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export async function saveLending(me: { companyId: string; name: string; role: string }, raw: Record<string, unknown>) {
  if (!canManage(me.role)) throw new UserError("貸し出し簿は管理者・経理担当がつけます");
  const item = String(raw.item ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  if (!item) throw new UserError("貸したものを入れてください");
  const today = jstDateKey(new Date());
  const lentOn = String(raw.lentOn ?? "") || today;
  if (!isDate(lentOn) || lentOn > today) throw new UserError("貸した日を正しく入れてください");
  const dueOn = String(raw.dueOn ?? "") || null;
  if (dueOn && (!isDate(dueOn) || dueOn < lentOn)) throw new UserError("返す日は貸した日より後にしてください");
  let borrowerId = typeof raw.borrowerId === "string" && raw.borrowerId ? raw.borrowerId : null;
  let borrowerName = String(raw.borrowerName ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
  if (borrowerId) {
    const u = await prisma.user.findFirst({ where: { id: borrowerId, companyId: me.companyId }, select: { name: true } });
    if (!u) borrowerId = null;
    else borrowerName = u.name;
  }
  if (!borrowerName) throw new UserError("貸した相手を入れてください");
  // 同じものがまだ返ってきていないとき(鍵が2本あるときはメモに書いて分ける)
  const out = await prisma.lending.findFirst({ where: { companyId: me.companyId, item, returnedOn: null } });
  if (out && raw.force !== true) throw new UserError(`「${item}」は${out.borrowerName}さんに貸したままです。先に返してもらうか、2つ目なら「2本目」などと名前を分けてください`);
  return prisma.lending.create({ data: { companyId: me.companyId, item, borrowerId, borrowerName, lentOn, dueOn, note: String(raw.note ?? "").trim().slice(0, 100) || null, byName: me.name } });
}

export async function returnLending(me: { companyId: string; role: string }, id: string, raw: Record<string, unknown> = {}) {
  if (!canManage(me.role)) throw new UserError("貸し出し簿は管理者・経理担当がつけます");
  const row = await prisma.lending.findFirst({ where: { id, companyId: me.companyId } });
  if (!row) throw new UserError("見つかりません");
  if (raw.undo === true) return prisma.lending.update({ where: { id }, data: { returnedOn: null } });
  if (row.returnedOn) throw new UserError("もう返してもらっています");
  return prisma.lending.update({ where: { id }, data: { returnedOn: jstDateKey(new Date()) } });
}

export async function extendLending(me: { companyId: string; role: string }, id: string, dueOn: string) {
  if (!canManage(me.role)) throw new UserError("貸し出し簿は管理者・経理担当がつけます");
  const row = await prisma.lending.findFirst({ where: { id, companyId: me.companyId } });
  if (!row || row.returnedOn) throw new UserError("貸し出し中のものが見つかりません");
  if (!isDate(dueOn) || dueOn < jstDateKey(new Date())) throw new UserError("返す日は今日より後にしてください");
  return prisma.lending.update({ where: { id }, data: { dueOn } });
}

export async function deleteLending(me: { companyId: string; role: string }, id: string) {
  if (!canManage(me.role)) throw new UserError("貸し出し簿は管理者・経理担当がつけます");
  const { count } = await prisma.lending.deleteMany({ where: { id, companyId: me.companyId } });
  if (!count) throw new UserError("見つかりません");
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export async function listLendings(companyId: string, q?: string) {
  const today = jstDateKey(new Date());
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86_400_000).toISOString().slice(0, 10);
  const search = q ? { OR: [{ item: { contains: q } }, { borrowerName: { contains: q } }] } : {};
  const [out, returned, past] = await Promise.all([
    prisma.lending.findMany({ where: { companyId, returnedOn: null, ...search }, orderBy: [{ dueOn: "asc" }, { lentOn: "asc" }] }),
    prisma.lending.findMany({ where: { companyId, returnedOn: q ? { not: null } : { gte: since }, ...search }, orderBy: [{ returnedOn: "desc" }, { updatedAt: "desc" }], take: 50 }),
    prisma.lending.findMany({ where: { companyId }, select: { item: true }, orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const items = out
    .map((r) => ({ ...r, overdueDays: r.dueOn && r.dueOn < today ? daysBetween(r.dueOn, today) : 0, days: daysBetween(r.lentOn, today) }))
    .sort((a, b) => b.overdueDays - a.overdueDays);
  // よく貸すもの(すぐ選べるように)。いま貸し出し中のものは外す
  const outNames = new Set(out.map((r) => r.item));
  const frequent = [...new Set(past.map((p) => p.item))].filter((n) => !outNames.has(n)).slice(0, 8);
  return { today, out: items, overdue: items.filter((r) => r.overdueDays > 0).length, returned, frequent };
}

// 朝のまとめ・やること用: 返す日を過ぎたもの
export async function overdueLendings(companyId: string) {
  const today = jstDateKey(new Date());
  return prisma.lending.findMany({ where: { companyId, returnedOn: null, dueOn: { lt: today } }, orderBy: { dueOn: "asc" } });
}

// 従業員: 自分が借りているもの(と最近返したもの)
export async function myLendings(me: { id: string; companyId: string }) {
  const today = jstDateKey(new Date());
  const rows = await prisma.lending.findMany({ where: { companyId: me.companyId, borrowerId: me.id, OR: [{ returnedOn: null }, { returnedOn: { gte: new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10) } }] }, orderBy: [{ returnedOn: "desc" }, { dueOn: "asc" }] });
  return rows.map((r) => ({ item: r.item, lentOn: r.lentOn, dueOn: r.dueOn, returnedOn: r.returnedOn, overdue: !r.returnedOn && !!r.dueOn && r.dueOn < today, dueToday: !r.returnedOn && r.dueOn === today }));
}
