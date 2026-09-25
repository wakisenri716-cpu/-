import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/csvParse";
import { UserError } from "@/lib/errors";

// 取引先・顧客・商品のCSV一括登録。見出しの列名で読み取り、エラーが1行でもあれば何も登録しない。
const MAX_ROWS = 1000;

function norm(s: string) {
  return s.normalize("NFKC").trim().toLowerCase().replace(/\s/g, "");
}

function readTable(text: string, columns: Record<string, string[]>, required: string[]) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new UserError("CSVにデータがありません(1行目は見出し、2行目から)");
  const header = rows[0].map(norm);
  const col = Object.fromEntries(Object.entries(columns).map(([k, names]) => [k, header.findIndex((h) => names.map(norm).includes(h))]));
  const missing = required.filter((k) => col[k] < 0);
  if (missing.length) throw new UserError(`見出しに ${missing.map((k) => columns[k][0]).join("・")} の列が見つかりません。サンプルCSVの形式に合わせてください`);
  if (rows.length - 1 > MAX_ROWS) throw new UserError(`一度に登録できるのは${MAX_ROWS}行までです`);
  return rows.slice(1).map((r, i) => ({ rowNumber: i + 2, get: (k: string) => (col[k] >= 0 ? (r[col[k]] ?? "").normalize("NFKC").trim() : "") }));
}

function fail(errors: string[]) {
  if (errors.length) throw new UserError(`登録できない行があります: ${errors.slice(0, 5).join(" / ")}${errors.length > 5 ? ` ほか${errors.length - 5}件` : ""}`);
}

export const PARTY_SAMPLE = [
  ["種類", "名前", "既定の勘定科目"],
  ["取引先", "株式会社サンプル文具", "消耗品費"],
  ["取引先", "〇〇電力", "5070"],
  ["顧客", "株式会社お客様商事", ""],
];

// 取引先(経費・仕入の相手)と顧客(売上の相手)。同じ名前がすでにあれば、既定の勘定科目だけ更新する。
export async function importParties(companyId: string, text: string) {
  const rows = readTable(text, { kind: ["種類", "区分"], name: ["名前", "取引先名", "顧客名", "名称"], account: ["既定の勘定科目", "勘定科目"] }, ["name"]);
  const accounts = await prisma.account.findMany({ where: { companyId, category: "EXPENSE" }, select: { id: true, code: true, name: true } });
  const accountBy = new Map<string, string>();
  for (const a of accounts) {
    accountBy.set(norm(a.code), a.id);
    accountBy.set(norm(a.name), a.id);
  }
  const errors: string[] = [];
  const vendors: { name: string; accountId: string | null }[] = [];
  const customers: string[] = [];
  for (const r of rows) {
    const name = r.get("name");
    if (!name) continue;
    const kind = r.get("kind") || "取引先";
    if (kind === "顧客") {
      customers.push(name);
      continue;
    }
    if (kind !== "取引先") {
      errors.push(`${r.rowNumber}行目: 種類は「取引先」か「顧客」にしてください`);
      continue;
    }
    const accountName = r.get("account");
    const accountId = accountName ? (accountBy.get(norm(accountName)) ?? null) : null;
    if (accountName && !accountId) errors.push(`${r.rowNumber}行目: 勘定科目「${accountName}」が見つかりません(経費の科目のコードか名前)`);
    vendors.push({ name, accountId });
  }
  fail(errors);

  const [existingVendors, existingCustomers] = await Promise.all([
    prisma.vendor.findMany({ where: { companyId }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { companyId }, select: { name: true } }),
  ]);
  const vendorByName = new Map(existingVendors.map((v) => [norm(v.name), v.id]));
  const customerNames = new Set(existingCustomers.map((c) => norm(c.name)));
  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const v of vendors) {
      const id = vendorByName.get(norm(v.name));
      if (id) {
        if (v.accountId) {
          await tx.vendor.update({ where: { id }, data: { defaultExpenseAccountId: v.accountId } });
          updated++;
        }
      } else {
        const createdVendor = await tx.vendor.create({ data: { companyId, name: v.name, defaultExpenseAccountId: v.accountId } });
        vendorByName.set(norm(v.name), createdVendor.id);
        created++;
      }
    }
    for (const name of customers) {
      if (customerNames.has(norm(name))) continue;
      await tx.customer.create({ data: { companyId, name } });
      customerNames.add(norm(name));
      created++;
    }
  });
  return { created, updated, skipped: vendors.length + customers.length - created - updated };
}

export const PRODUCT_SAMPLE = [
  ["商品名", "コード", "単位", "発注点"],
  ["コーヒー豆(200g)", "C-001", "袋", "5"],
  ["紙コップ", "P-010", "箱", "2"],
];

// 商品。同じ名前がすでにあれば、コード・単位・発注点を更新する(在庫数は入庫・棚卸で入れる)。
export async function importProducts(companyId: string, text: string) {
  const rows = readTable(text, { name: ["商品名", "名前", "品名"], code: ["コード", "商品コード"], unit: ["単位"], reorderPoint: ["発注点"] }, ["name"]);
  const errors: string[] = [];
  const items: { name: string; code: string | null; unit: string | null; reorderPoint: number | null }[] = [];
  for (const r of rows) {
    const name = r.get("name");
    if (!name) continue;
    const rp = r.get("reorderPoint");
    if (rp && !/^\d+$/.test(rp)) errors.push(`${r.rowNumber}行目: 発注点は0以上の整数で入力してください`);
    items.push({ name, code: r.get("code") || null, unit: r.get("unit") || null, reorderPoint: rp ? Number(rp) : null });
  }
  fail(errors);

  const existing = await prisma.product.findMany({ where: { companyId }, select: { id: true, name: true } });
  const byName = new Map(existing.map((p) => [norm(p.name), p.id]));
  let created = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const id = byName.get(norm(item.name));
      const data = { ...(item.code ? { code: item.code } : {}), ...(item.unit ? { unit: item.unit } : {}), ...(item.reorderPoint !== null ? { reorderPoint: item.reorderPoint } : {}) };
      if (id) {
        if (Object.keys(data).length) {
          await tx.product.update({ where: { id }, data });
          updated++;
        }
      } else {
        const p = await tx.product.create({ data: { companyId, name: item.name, ...data } });
        byName.set(norm(item.name), p.id);
        created++;
      }
    }
  });
  return { created, updated, skipped: items.length - created - updated };
}
