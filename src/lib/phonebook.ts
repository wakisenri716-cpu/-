import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";

// 社内の電話帳(内線表): 「山田 花子 経理 内線201 携帯 090-1234-5678」「受付 100」のような行をまとめて貼り付けると、
// 名前・部署・内線・直通・社用携帯に分けて入れる。Excelからコピーした表(タブ区切り)もそのまま読める。

type Member = { id: string; name: string };
export type PhoneDraft = { name: string; userId: string | null; department: string | null; extension: string | null; direct: string | null; mobile: string | null; note: string | null };

const DEPT = /^(?:[^\s]{1,10}(?:部|課|室|係|チーム|グループ|センター|事業所|支店|営業所)|経理|総務|人事|営業|製造|開発|企画|広報|受付|役員|社長室)$/;
const PHONE = /0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10}/;
const flat = (s: string) => s.normalize("NFKC").replace(/\s/g, "");

export function templatePhoneLine(line: string, users: Member[]): PhoneDraft | null {
  let t = line.normalize("NFKC").replace(/[\t,、|]+/g, " ").replace(/[‐－―ー−](?=\d)/g, "-").replace(/\s+/g, " ").replace(/(?<!\d)(0\d{1,4}) (\d{1,4}) (\d{3,4})(?!\d)/g, "$1-$2-$3").trim();
  if (!t || /^(名前|氏名|部署)\s/.test(t)) return null; // 見出しの行
  let note: string | null = null;
  const noteM = t.match(/[((]([^))]{1,40})[))]|※\s?(.{1,40})$/);
  if (noteM) {
    note = (noteM[1] ?? noteM[2]).trim();
    t = t.replace(noteM[0], " ");
  }
  let mobile: string | null = null;
  let direct: string | null = null;
  let extension: string | null = null;
  const take = (re: RegExp) => {
    const m = t.match(re);
    if (!m) return null;
    t = t.replace(m[0], " ");
    return m[1];
  };
  mobile = take(/(?:携帯|ケータイ|社用携帯|スマホ|mobile)\s*[::]?\s*(0\d{1,4}-?\d{1,4}-?\d{3,4})/i);
  direct = take(/(?:直通|外線|TEL|電話)\s*[::]?\s*(0\d{1,4}-?\d{1,4}-?\d{3,4})/i);
  extension = take(/(?:内線|ext\.?|#)\s*[::]?\s*(\d{2,6})/i);
  // 書き方がないとき: 0X0-で始まる番号は携帯、それ以外の0で始まる番号は直通、2〜6けたの数字は内線
  for (let m = t.match(PHONE); m; m = t.match(PHONE)) {
    if (/^0[789]0/.test(m[0]) && !mobile) mobile = m[0];
    else if (!direct) direct = m[0];
    t = t.replace(m[0], " ");
  }
  if (!extension) extension = take(/(?:^|\s)(\d{2,6})(?=\s|$)/);
  let rest = t.replace(/(内線|直通|携帯|番号)/g, " ");
  // 社内の人の名前が入っていればその人に合わせる(名字が「経理」のような部署名と同じでも先に名前として取る)
  const exact = [...users].sort((a, b) => flat(b.name).length - flat(a.name).length).find((u) => flat(rest).includes(flat(u.name)));
  if (exact) {
    const parts = exact.name.normalize("NFKC").split(/\s+/);
    rest = rest.replace(new RegExp(parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")), " ");
  }
  const words = rest.split(" ").filter(Boolean);
  const department = words.find((w) => DEPT.test(w)) ?? null;
  let nameWords = exact ? [] : words.filter((w) => w !== department);
  const joined = flat(nameWords.join(""));
  const member = exact ?? users.find((u) => flat(u.name) === joined) ?? users.find((u) => joined && flat(u.name).startsWith(joined) && joined.length >= 2) ?? null;
  if (!nameWords.length && department) nameWords = [department]; // 「受付 100」のように場所だけの行
  const name = (member?.name ?? nameWords.join(" ")).slice(0, 40);
  if (!name || (!extension && !direct && !mobile)) return null;
  return { name, userId: member?.id ?? null, department: name === department ? null : department, extension, direct, mobile, note: note?.slice(0, 60) ?? null };
}

const users = (companyId: string) => prisma.user.findMany({ where: { companyId, active: true, role: { not: "ADVISOR" } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });

export async function parsePhoneLines(companyId: string, text: string) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200);
  if (!lines.length) throw new UserError("「山田 花子 経理 内線201」のように1人1行で書いてください");
  const us = await users(companyId);
  const drafts: PhoneDraft[] = [];
  const skipped: string[] = [];
  for (const l of lines) {
    const d = templatePhoneLine(l, us);
    if (d) drafts.push(d);
    else skipped.push(l.slice(0, 60));
  }
  return { drafts, skipped };
}

const canManage = (role: string) => role === "ADMIN" || role === "ACCOUNTANT";
const clean = (v: unknown, n: number) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, n) || null;

// まとめて入れる(同じ名前はあたらしい番号に入れかえる)
export async function savePhoneEntries(me: { companyId: string; role: string }, raw: unknown) {
  if (!canManage(me.role)) throw new UserError("電話帳は管理者・経理担当が直します");
  const rows = Array.isArray(raw) ? raw.slice(0, 200) : [];
  const us = await users(me.companyId);
  let saved = 0;
  for (const r of rows as Record<string, unknown>[]) {
    const name = clean(r.name, 40);
    if (!name) continue;
    const extension = clean(r.extension, 10)?.replace(/[^\d]/g, "") || null;
    const direct = clean(r.direct, 20);
    const mobile = clean(r.mobile, 20);
    if (!extension && !direct && !mobile) throw new UserError(`${name}の番号を入れてください`);
    for (const p of [direct, mobile]) if (p && !/^[\d-]{6,20}$/.test(p)) throw new UserError(`${name}の電話番号を正しく入れてください`);
    const userId = typeof r.userId === "string" && us.some((u) => u.id === r.userId) ? r.userId : (us.find((u) => flat(u.name) === flat(name))?.id ?? null);
    const data = { userId, department: clean(r.department, 30), extension, direct, mobile, note: clean(r.note, 60) };
    await prisma.phoneEntry.upsert({ where: { companyId_name: { companyId: me.companyId, name } }, create: { companyId: me.companyId, name, ...data }, update: data });
    saved++;
  }
  if (!saved) throw new UserError("入れるものがありません");
  return { saved };
}

export async function deletePhoneEntry(me: { companyId: string; role: string }, id: string) {
  if (!canManage(me.role)) throw new UserError("電話帳は管理者・経理担当が直します");
  const { count } = await prisma.phoneEntry.deleteMany({ where: { id, companyId: me.companyId } });
  if (!count) throw new UserError("見つかりません");
}

// 部署ごと(部署のないものは最後)。q で名前・部署・番号を探す
export async function listPhonebook(companyId: string, q?: string) {
  const n = q ? q.normalize("NFKC").trim() : "";
  const digits = n.replace(/[^\d]/g, "");
  const rows = await prisma.phoneEntry.findMany({ where: { companyId }, orderBy: [{ department: "asc" }, { extension: "asc" }, { name: "asc" }] });
  const hit = (r: (typeof rows)[number]) => !n || flat(r.name).includes(flat(n)) || (r.department ?? "").includes(n) || (!!digits && digits.length >= 2 && [r.extension, r.direct, r.mobile].some((x) => (x ?? "").replace(/-/g, "").includes(digits)));
  const items = rows.filter(hit);
  const groups = new Map<string, typeof items>();
  for (const r of items) groups.set(r.department ?? "", [...(groups.get(r.department ?? "") ?? []), r]);
  return { count: rows.length, items, groups: [...groups.entries()].sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "ja"))).map(([department, entries]) => ({ department: department || null, entries })) };
}

// AI・朝のまとめなどから: だれか・どこかの番号を探す(名前の一部、部署、「受付」など)
export async function findPhone(companyId: string, query: string) {
  const q = query.normalize("NFKC").replace(/(さん|様|部長|課長|の内線|の番号|の電話|内線|番号|電話|は|に|を)+$/g, "").trim();
  if (!q) return [];
  const { items } = await listPhonebook(companyId, q);
  if (items.length) return items.slice(0, 10);
  // 名字だけ・名前だけ
  const { items: all } = await listPhonebook(companyId);
  return all.filter((r) => r.name.split(" ").some((w) => w && (w === q || q.includes(w)))).slice(0, 10);
}
