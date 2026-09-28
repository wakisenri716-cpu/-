import type { EquipmentStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";

// 備品管理: パソコン・スマホ・鍵などの台帳と、誰に貸しているか(貸出・返却の記録)

export const STATUS_LABEL: Record<EquipmentStatus, string> = { ACTIVE: "使用中", BROKEN: "故障", DISPOSED: "廃棄" };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number, label: string, required = false) {
  const v = String(value ?? "").trim();
  if (required && !v) throw new UserError(`${label}を入力してください`);
  if (v.length > max) throw new UserError(`${label}は${max}文字以内で入力してください`);
  return v || null;
}

function date(value: unknown, label: string) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) throw new UserError(`${label}を正しく入力してください`);
  return new Date(`${v}T00:00:00Z`);
}

type EquipmentInput = { code?: unknown; name?: unknown; category?: unknown; serialNumber?: unknown; location?: unknown; purchaseDate?: unknown; price?: unknown; status?: unknown; notes?: unknown };

const FIELDS = ["code", "name", "category", "serialNumber", "location", "purchaseDate", "price", "status", "notes"] as const;
const key = (d: Date | null) => (d ? jstDateKey(d) : null);

async function parse(companyId: string, input: EquipmentInput, exceptId?: string) {
  const code = text(input.code, 30, "管理番号");
  if (code && (await prisma.equipment.findFirst({ where: { companyId, code, ...(exceptId ? { id: { not: exceptId } } : {}) } }))) throw new UserError(`管理番号「${code}」はすでに使われています`);
  const rawPrice = String(input.price ?? "").replaceAll(",", "").trim();
  const price = rawPrice ? Number(rawPrice) : null;
  if (price !== null && (!Number.isInteger(price) || price < 0 || price > 1_000_000_000)) throw new UserError("購入金額は0以上の整数(円)で入力してください");
  const status = String(input.status ?? "ACTIVE") as EquipmentStatus;
  if (!(status in STATUS_LABEL)) throw new UserError("状態を選んでください");
  return {
    code,
    name: text(input.name, 60, "備品名", true)!,
    category: text(input.category, 30, "種類"),
    serialNumber: text(input.serialNumber, 60, "製造番号"),
    location: text(input.location, 60, "保管場所"),
    purchaseDate: date(input.purchaseDate, "購入日"),
    price,
    status,
    notes: text(input.notes, 500, "メモ"),
  };
}

export async function createEquipment(companyId: string, input: EquipmentInput) {
  return prisma.equipment.create({ data: { companyId, ...(await parse(companyId, input)) } });
}

export async function updateEquipment(companyId: string, id: string, input: EquipmentInput) {
  const current = await prisma.equipment.findFirst({ where: { id, companyId }, include: { loans: { where: { returnedAt: null } } } });
  if (!current) throw new UserError("備品が見つかりません");
  // 送られてきた項目だけ変える(状態だけの変更など)
  const saved: EquipmentInput = { ...current, purchaseDate: key(current.purchaseDate) ?? "", price: current.price ?? "" };
  const merged = Object.fromEntries(FIELDS.map((f) => [f, input[f] === undefined ? saved[f] : input[f]])) as EquipmentInput;
  const data = await parse(companyId, merged, id);
  if (data.status !== "ACTIVE" && current.loans.length) throw new UserError("貸出中の備品は、返却してから故障・廃棄にしてください");
  return prisma.equipment.update({ where: { id }, data });
}

export async function deleteEquipment(companyId: string, id: string) {
  const current = await prisma.equipment.findFirst({ where: { id, companyId }, include: { _count: { select: { loans: true } } } });
  if (!current) throw new UserError("備品が見つかりません");
  // 貸出の記録がある備品は、記録を残すため消さずに「廃棄」にしてもらう
  if (current._count.loans) throw new UserError("貸出の記録がある備品は削除できません。状態を「廃棄」にしてください");
  await prisma.equipment.delete({ where: { id } });
  return current;
}

// 貸し出す。borrower はメンバーのユーザーID、なければ名前(外部の人など)
export async function lend(companyId: string, id: string, input: { userId?: unknown; borrowerName?: unknown; lentAt?: unknown; dueDate?: unknown; notes?: unknown }) {
  const equipment = await prisma.equipment.findFirst({ where: { id, companyId } });
  if (!equipment) throw new UserError("備品が見つかりません");
  if (equipment.status !== "ACTIVE") throw new UserError("故障・廃棄の備品は貸し出せません");
  let userId: string | null = null;
  let borrowerName = text(input.borrowerName, 40, "借りる人");
  if (input.userId) {
    const member = await prisma.companyMember.findFirst({ where: { companyId, userId: String(input.userId), active: true }, include: { user: { select: { id: true, name: true } } } });
    if (!member) throw new UserError("借りる人が見つかりません");
    userId = member.user.id;
    borrowerName = member.user.name;
  }
  if (!borrowerName) throw new UserError("借りる人を選ぶか、名前を入力してください");
  const lentAt = date(input.lentAt, "貸出日") ?? new Date(`${jstDateKey(new Date())}T00:00:00Z`);
  const dueDate = date(input.dueDate, "返却予定日");
  if (dueDate && dueDate < lentAt) throw new UserError("返却予定日は貸出日以降にしてください");
  return prisma.$transaction(async (tx) => {
    // 同時に2人に貸さないよう、貸出中の記録がないことを確かめてから作る
    if (await tx.equipmentLoan.count({ where: { equipmentId: id, returnedAt: null } })) throw new UserError("この備品はすでに貸出中です");
    return tx.equipmentLoan.create({ data: { equipmentId: id, userId, borrowerName, lentAt, dueDate, notes: text(input.notes, 200, "メモ") }, include: { equipment: true } });
  });
}

export async function returnLoan(companyId: string, id: string, input: { returnedAt?: unknown }) {
  const loan = await prisma.equipmentLoan.findFirst({ where: { equipmentId: id, returnedAt: null, equipment: { companyId } }, include: { equipment: true } });
  if (!loan) throw new UserError("貸出中ではありません");
  const returnedAt = date(input.returnedAt, "返却日") ?? new Date(`${jstDateKey(new Date())}T00:00:00Z`);
  if (returnedAt < loan.lentAt) throw new UserError("返却日は貸出日以降にしてください");
  const updated = await prisma.equipmentLoan.updateMany({ where: { id: loan.id, returnedAt: null }, data: { returnedAt } });
  if (updated.count !== 1) throw new UserError("状態が変わりました。画面を更新してもう一度お試しください");
  return loan;
}

export async function listEquipment(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const [items, members] = await Promise.all([
    prisma.equipment.findMany({
      where: { companyId },
      include: { loans: { orderBy: { lentAt: "desc" }, take: 20 } },
      orderBy: [{ status: "asc" }, { code: "asc" }, { name: "asc" }],
    }),
    prisma.companyMember.findMany({ where: { companyId, active: true }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const rows = items.map((e) => {
    const current = e.loans.find((l) => !l.returnedAt) ?? null;
    return {
      id: e.id,
      code: e.code,
      name: e.name,
      category: e.category,
      serialNumber: e.serialNumber,
      location: e.location,
      purchaseDate: key(e.purchaseDate),
      price: e.price,
      status: e.status,
      notes: e.notes,
      loan: current && {
        borrowerName: current.borrowerName,
        lentAt: key(current.lentAt)!,
        dueDate: key(current.dueDate),
        overdue: !!current.dueDate && key(current.dueDate)! < today,
      },
      history: e.loans.map((l) => ({ id: l.id, borrowerName: l.borrowerName, lentAt: key(l.lentAt)!, dueDate: key(l.dueDate), returnedAt: key(l.returnedAt), notes: l.notes })),
    };
  });
  const active = rows.filter((r) => r.status === "ACTIVE");
  return {
    members: members.map((m) => m.user),
    categories: [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))].sort(),
    items: rows,
    summary: {
      total: active.length,
      lent: active.filter((r) => r.loan).length,
      overdue: active.filter((r) => r.loan?.overdue).length,
      value: active.reduce((s, r) => s + (r.price ?? 0), 0),
    },
  };
}

// 返却予定日を過ぎても返っていない貸出(やることリスト用)
export function countOverdueLoans(companyId: string, now = new Date()) {
  return prisma.equipmentLoan.count({ where: { returnedAt: null, dueDate: { lt: new Date(`${jstDateKey(now)}T00:00:00Z`) }, equipment: { companyId } } });
}

// 自分が借りている備品(従業員も見られる)
export async function myLoans(companyId: string, userId: string) {
  const loans = await prisma.equipmentLoan.findMany({ where: { userId, returnedAt: null, equipment: { companyId } }, include: { equipment: { select: { name: true, code: true } } }, orderBy: { lentAt: "asc" } });
  return loans.map((l) => ({ id: l.id, name: l.equipment.name, code: l.equipment.code, lentAt: key(l.lentAt)!, dueDate: key(l.dueDate) }));
}
