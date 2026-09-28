import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";

// 住所録: 顧客(売上の相手)・取引先(支払先)の郵便番号・住所・部署・担当者・敬称。
// 送付状・封筒・宛名ラベルと、請求書などの宛先に使う。

export type PartyKind = "customer" | "vendor";
export const HONORIFICS = ["御中", "様"] as const;

export type Contact = {
  postalCode: string | null;
  address: string | null;
  department: string | null;
  contactName: string | null;
  honorific: string | null;
  phone: string | null;
};

function text(value: unknown, max: number, label: string) {
  const v = String(value ?? "").trim();
  if (v.length > max) throw new UserError(`${label}は${max}文字以内で入力してください`);
  return v || null;
}

export function parseContact(input: Record<string, unknown>): Contact {
  const rawPostal = String(input.postalCode ?? "")
    .normalize("NFKC")
    .replace(/[〒\s]/g, "")
    .replace(/[‐ー−]/g, "-");
  let postalCode: string | null = null;
  if (rawPostal) {
    const digits = rawPostal.replace("-", "");
    if (!/^\d{7}$/.test(digits)) throw new UserError("郵便番号は7桁の数字で入力してください(例: 100-0001)");
    postalCode = `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  const honorific = String(input.honorific ?? "") || null;
  if (honorific && !(HONORIFICS as readonly string[]).includes(honorific)) throw new UserError("敬称を選んでください");
  return {
    postalCode,
    address: text(input.address, 200, "住所"),
    department: text(input.department, 60, "部署"),
    contactName: text(input.contactName, 60, "担当者名"),
    honorific,
    phone: text(input.phone, 30, "電話番号"),
  };
}

export async function updateContact(companyId: string, kind: PartyKind, id: string, input: Record<string, unknown>) {
  const data = parseContact(input);
  const updated =
    kind === "customer"
      ? await prisma.customer.updateMany({ where: { id, companyId }, data })
      : await prisma.vendor.updateMany({ where: { id, companyId }, data });
  if (updated.count !== 1) throw new UserError(kind === "customer" ? "顧客が見つかりません" : "取引先が見つかりません");
  return data;
}

const SELECT = { id: true, name: true, postalCode: true, address: true, department: true, contactName: true, honorific: true, phone: true } as const;

export async function getParty(companyId: string, kind: PartyKind, id: string) {
  return kind === "customer"
    ? prisma.customer.findFirst({ where: { id, companyId }, select: SELECT })
    : prisma.vendor.findFirst({ where: { id, companyId }, select: SELECT });
}

// 宛名の書き方: 担当者がいれば「会社名 / 部署 / 担当者名 様」、いなければ「会社名(部署) 御中」
export function addressee(p: { name: string; department: string | null; contactName: string | null; honorific: string | null }) {
  if (p.contactName) return { lines: [p.name, p.department].filter(Boolean) as string[], main: `${p.contactName} 様` };
  const honorific = p.honorific ?? "御中";
  return p.department ? { lines: [p.name], main: `${p.department} ${honorific}` } : { lines: [], main: `${p.name} ${honorific}` };
}

// 請求書などの宛先の下に添える住所(郵便番号と住所)
export function addressLine(p: { postalCode: string | null; address: string | null } | null | undefined) {
  if (!p || (!p.postalCode && !p.address)) return null;
  return [p.postalCode && `〒${p.postalCode}`, p.address].filter(Boolean).join(" ");
}

// 請求書などの宛先の下に添える「部署 担当者 様」
export function attentionLine(p: { department: string | null; contactName: string | null } | null | undefined) {
  if (!p || (!p.department && !p.contactName)) return null;
  return [p.department, p.contactName && `${p.contactName} 様`].filter(Boolean).join(" ");
}

export async function listAddressBook(companyId: string) {
  const [customers, vendors] = await Promise.all([
    prisma.customer.findMany({ where: { companyId }, select: SELECT, orderBy: { name: "asc" } }),
    prisma.vendor.findMany({ where: { companyId }, select: SELECT, orderBy: { name: "asc" } }),
  ]);
  return [...customers.map((c) => ({ ...c, kind: "customer" as const })), ...vendors.map((v) => ({ ...v, kind: "vendor" as const }))];
}

// "customer:ID,vendor:ID" の並びから、宛名ラベルに載せる相手を取り出す
export async function partiesFromKeys(companyId: string, keys: string) {
  const list = keys
    .split(",")
    .map((k) => k.split(":"))
    .filter((p): p is [PartyKind, string] => (p[0] === "customer" || p[0] === "vendor") && !!p[1])
    .slice(0, 120);
  const found = await Promise.all(list.map(([kind, id]) => getParty(companyId, kind, id)));
  return found.filter((p): p is NonNullable<typeof p> => !!p);
}
