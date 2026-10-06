import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { createManualJournal } from "@/lib/accounting/journal";
import { issueInvoice } from "@/lib/accounting/issueInvoice";
import { recordInvoicePayment } from "@/lib/accounting/payments";
import { createProduct, recordStockMovement } from "@/lib/accounting/inventory";
import { createShift, createStaff } from "@/lib/shifts/service";
import { createManual } from "@/lib/manuals";
import { ensureBankAccounts } from "@/lib/bank/accounts";
import { resolveFiscalYear } from "@/lib/accounting/monthly";

// お試し用の会社: サンプルデータ(売上・経費・予算・請求書・シフト・在庫・マニュアル・銀行明細)を入れた別の会社を作る。
// 自分の会社のデータには一切さわらない。課金はしない(Company.isDemo)。

const DEMO_NAME = "サンプル商店(お試し用)";

// 今日から n か月前の d 日(今日より先にならないように)
function dayOf(monthsAgo: number, day: number) {
  const [y, m, today] = jstDateKey(new Date()).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - monthsAgo, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const dd = monthsAgo === 0 ? Math.min(day, today) : Math.min(day, last);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}
const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function findDemoCompany(userId: string) {
  const member = await prisma.companyMember.findFirst({ where: { userId, active: true, company: { isDemo: true } }, select: { companyId: true } });
  return member?.companyId ?? null;
}

export async function createDemoCompany(userId: string) {
  const existing = await findDemoCompany(userId);
  if (existing) return existing;
  // しまったお試し用の会社があれば、それを出し直す(新しく作らない)
  const hidden = await prisma.companyMember.findFirst({ where: { userId, active: false, company: { isDemo: true } } });
  if (hidden) {
    await prisma.companyMember.update({ where: { id: hidden.id }, data: { active: true } });
    return hidden.companyId;
  }
  if ((await prisma.companyMember.count({ where: { userId } })) >= 20) throw new UserError("1人で入れる会社は20社までです");

  const company = await prisma.company.create({
    data: { name: DEMO_NAME, isDemo: true, fiscalYearStartMonth: 4, onboardedAt: new Date(), address: "東京都千代田区丸の内1-1-1(サンプル)", members: { create: { userId, role: "ADMIN" } } },
  });
  const companyId = company.id;
  await ensureChartOfAccounts(companyId);
  const accounts = new Map((await prisma.account.findMany({ where: { companyId }, select: { id: true, code: true } })).map((a) => [a.code, a.id]));
  const id = (code: string) => accounts.get(code)!;

  // 部門(店舗)と取引先
  const [main, station] = await Promise.all([
    prisma.department.create({ data: { companyId, name: "本店" } }),
    prisma.department.create({ data: { companyId, name: "駅前店" } }),
  ]);
  await prisma.customer.createMany({
    data: [
      { companyId, name: "株式会社みどり商事", email: "midori@example.com" },
      { companyId, name: "あおば工務店", email: "aoba@example.com" },
      { companyId, name: "カフェ さくら" },
    ],
  });
  await prisma.vendor.createMany({ data: [{ companyId, name: "丸の内ビル管理" }, { companyId, name: "東京電力(サンプル)" }, { companyId, name: "食材の山田" }] });

  // 半年分の売上・仕入・経費(毎月少しずつ変える)
  const journal = (date: string, description: string, debit: string, credit: string, amount: number, departmentId?: string) =>
    createManualJournal(companyId, {
      date: new Date(`${date}T00:00:00Z`),
      description,
      departmentId,
      lines: [
        { accountId: id(debit), debit: amount, credit: 0 },
        { accountId: id(credit), debit: 0, credit: amount },
      ],
    });
  for (let i = 5; i >= 0; i--) {
    const k = 6 - i;
    await journal(dayOf(i, 25), "店頭売上(本店)", "1020", "4010", 820_000 + k * 35_000, main.id);
    await journal(dayOf(i, 25), "店頭売上(駅前店)", "1020", "4010", 540_000 + k * 22_000, station.id);
    await journal(dayOf(i, 10), "食材の仕入", "5000", "1020", 410_000 + k * 15_000);
    await journal(dayOf(i, 27), "事務所・店舗の家賃", "5060", "1020", 280_000);
    await journal(dayOf(i, 20), "電気・ガス・水道", "5070", "1020", 62_000 + (k % 3) * 8_000);
    await journal(dayOf(i, 26), "電話・インターネット", "5040", "1020", 18_400);
    await journal(dayOf(i, 25), "アルバイトの給料", "5110", "1020", 310_000 + k * 9_000);
    if (k % 2 === 0) await journal(dayOf(i, 15), "チラシの印刷", "5130", "1020", 45_000);
    // 毎月のサブスク(固定費の見直しを試せるように。クラウドストレージは先月から値上がり)
    await journal(dayOf(i, 3), "クラウドストレージの利用料", "5040", "1020", k >= 5 ? 1_650 : 1_320);
    await journal(dayOf(i, 5), "Web会議サービス", "5040", "1020", 2_200);
    await journal(dayOf(i, 8), "店内BGMの配信サービス", "5990", "1020", 1_980);
  }
  await journal(dayOf(1, 18), "Web広告(キャンペーン)", "5130", "1020", 160_000);

  // 今期の予算(予算の進み具合・予算と実績の差の原因を試せるように)
  const { year } = await resolveFiscalYear(companyId, null);
  const budgets: [string, number][] = [
    ["4010", 19_800_000],
    ["5000", 5_400_000],
    ["5060", 3_360_000],
    ["5070", 760_000],
    ["5110", 4_000_000],
    ["5130", 300_000],
  ];
  await prisma.budget.createMany({ data: budgets.map(([code, amount]) => ({ companyId, fiscalYear: year, accountId: id(code), amount })) });

  // 請求書(1件は入金済み、1件は期日前、1件は期日を過ぎて未入金)
  const lines = (desc: string, qty: number, price: number) => [{ description: desc, quantity: qty, unit: "式", unitPrice: price, taxRate: 10 }];
  const paid = await issueInvoice(companyId, { customerName: "株式会社みどり商事", issueDate: dayOf(1, 5), dueDate: dayOf(1, 28), lines: lines("お弁当の配達(月額)", 1, 180_000) });
  await recordInvoicePayment(paid.id, paid.totalAmount, new Date(`${dayOf(1, 28)}T00:00:00Z`));
  await issueInvoice(companyId, { customerName: "あおば工務店", issueDate: dayOf(2, 10), dueDate: dayOf(1, 10), lines: lines("現場への差し入れ", 3, 25_000) });
  await issueInvoice(companyId, { customerName: "カフェ さくら", issueDate: dayOf(0, 1), dueDate: addDays(dayOf(0, 1), 40), lines: lines("焼き菓子の卸", 120, 300) });

  // スタッフと今週・来週のシフト
  const staffNames: [string, number][] = [
    ["佐藤 みき", 1200],
    ["鈴木 けんた", 1150],
    ["高橋 ゆい", 1250],
  ];
  const staff = [];
  for (const [name, wage] of staffNames) staff.push(await createStaff(companyId, { name, hourlyWage: wage }));
  const today = jstDateKey(new Date());
  // 入社・退職の手続きナビ用: 高橋さんは3日前に入社、鈴木さんは3週間後に退職
  await prisma.staff.update({ where: { id: staff[2].id }, data: { hireDate: new Date(`${addDays(today, -3)}T00:00:00+09:00`), socialInsurance: true, employmentInsurance: true } });
  await prisma.staff.update({ where: { id: staff[1].id }, data: { employmentInsurance: true, profile: { retireDate: addDays(today, 21), retireReason: "自己都合" } } });
  for (let d = 0; d < 10; d++) {
    const date = addDays(today, d - 2);
    for (const [i, s] of staff.entries()) {
      if ((d + i) % 3 === 2) continue; // 休みの日
      await createShift(companyId, { staffId: s.id, date, start: i === 1 ? "14:00" : "09:00", end: i === 1 ? "21:00" : "17:00", breakMinutes: 60 });
    }
  }

  // 在庫
  const products: [string, string, string, number, number][] = [
    ["コーヒー豆", "kg", "A-01", 12, 2_400],
    ["紙コップ", "箱", "A-02", 3, 1_800],
    ["焼き菓子の箱", "箱", "B-01", 40, 120],
  ];
  for (const [name, unit, code, qty, cost] of products) {
    const p = await createProduct(companyId, { name, unit, code });
    await recordStockMovement(companyId, { productId: p.id, type: "PURCHASE", date: new Date(`${dayOf(0, 1)}T00:00:00Z`), quantity: qty, unitCost: cost, paymentAccountCode: "1020" });
  }
  await prisma.product.updateMany({ where: { companyId, code: "A-02" }, data: { reorderPoint: 5 } });

  // マニュアル
  await createManual(companyId, {
    title: "開店前の準備",
    category: "開店・閉店",
    pinned: true,
    published: true,
    body: "# 手順\n1. 照明とエアコンをつける\n2. レジのお金を数える(**3万円**)\n3. 看板を出す\n\n注意: 床がぬれていたら、すぐにふいてください",
  });

  // 確認待ちの銀行明細(取り込んだばかりの状態)
  const bank = await ensureBankAccounts(companyId);
  const pending: [string, string, number, number, string | null, number | null, string | null][] = [
    [dayOf(0, 2), "ﾌﾘｺﾐﾃｽｳﾘｮｳ", 440, 0, "5080", 0.95, "摘要に「手数料」"],
    [dayOf(0, 3), "ｱﾏｿﾞﾝ ｼﾞﾔﾊﾟﾝ", 6_380, 0, "5030", 0.75, "通販での購入(消耗品の可能性が高い)"],
    [dayOf(0, 4), "ﾌﾘｺﾐ ｶ)ﾐﾄﾞﾘｼｮｳｼﾞ", 0, 55_000, null, null, null],
  ];
  await prisma.bankTransaction.createMany({
    data: pending.map(([date, description, withdrawal, deposit, code, confidence, reason], i) => ({
      companyId,
      bankAccountId: bank.id,
      date: new Date(`${date}T00:00:00Z`),
      description,
      withdrawal,
      deposit,
      fingerprint: `demo-${companyId}-${i}`,
      status: "PENDING" as const,
      suggestedAccountCode: code ?? "4010",
      confidence: confidence ?? 0.4,
      suggestionSource: code ? "RULE" : "AI",
      suggestionReason: reason ?? "入金の内容から売上と判定(信頼度が低いため確認待ち)",
    })),
  });
  return companyId;
}

// お試し用の会社をしまう(一覧から外す。データは残る)
export async function hideDemoCompany(userId: string, companyId: string) {
  const member = await prisma.companyMember.findFirst({ where: { userId, companyId, company: { isDemo: true } } });
  if (!member) throw new UserError("お試し用の会社が見つかりません");
  await prisma.companyMember.update({ where: { id: member.id }, data: { active: false } });
}
