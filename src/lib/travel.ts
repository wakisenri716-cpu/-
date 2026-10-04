import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { ensureChartOfAccounts } from "@/lib/accounting/accounts";
import { postExpenseItemJournal } from "@/lib/accounting/automation";

// 出張旅費規程と出張: 規程の定額で日当・宿泊費を計算し、経費精算(旅費交通費)に入れる。

const TRAVEL_ACCOUNT = "5010"; // 旅費交通費
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 60;

type Actor = { id: string; name: string; companyId: string; role: string };

export async function getPolicy(companyId: string) {
  return prisma.travelPolicy.findUnique({ where: { companyId } });
}

const yen = (v: unknown, label: string) => {
  const n = Number(String(v ?? "0").normalize("NFKC").replace(/[,¥円\s]/g, "") || "0");
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new UserError(`${label}は0〜1,000,000円の整数で入力してください`);
  return n;
};

export async function savePolicy(companyId: string, input: Record<string, unknown>) {
  const data = {
    dayTripAllowance: yen(input.dayTripAllowance, "日帰り出張の日当"),
    dailyAllowance: yen(input.dailyAllowance, "宿泊出張の日当"),
    lodging: yen(input.lodging, "宿泊費"),
    overseasDaily: yen(input.overseasDaily, "海外出張の日当"),
    overseasLodging: yen(input.overseasLodging, "海外出張の宿泊費"),
    effectiveDate: input.effectiveDate && DATE.test(String(input.effectiveDate)) ? new Date(`${input.effectiveDate}T00:00:00Z`) : null,
  };
  return prisma.travelPolicy.upsert({ where: { companyId }, create: { companyId, ...data }, update: data });
}

type TripInput = { destination?: unknown; purpose?: unknown; startDate?: unknown; endDate?: unknown; nights?: unknown; overseas?: unknown };

// 日当・宿泊費の計算: 日帰りは日帰りの日当、泊まりは(日数 × 日当)+(泊数 × 宿泊費)
export function calcTrip(policy: { dayTripAllowance: number; dailyAllowance: number; lodging: number; overseasDaily: number; overseasLodging: number }, days: number, nights: number, overseas: boolean) {
  if (overseas) return { allowance: days * policy.overseasDaily, lodging: nights * policy.overseasLodging };
  if (nights === 0) return { allowance: days * policy.dayTripAllowance, lodging: 0 };
  return { allowance: days * policy.dailyAllowance, lodging: nights * policy.lodging };
}

function parseTrip(input: TripInput) {
  const destination = String(input.destination ?? "").trim().slice(0, 100);
  if (!destination) throw new UserError("行き先を入力してください");
  const purpose = String(input.purpose ?? "").trim().slice(0, 200);
  if (!purpose) throw new UserError("出張の目的を入力してください");
  const start = String(input.startDate ?? "");
  const end = String(input.endDate ?? "") || start;
  if (!DATE.test(start) || !DATE.test(end)) throw new UserError("出発日・帰着日を正しく入力してください");
  if (end < start) throw new UserError("帰着日は出発日より後にしてください");
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  if (days > MAX_DAYS) throw new UserError(`1回の出張は${MAX_DAYS}日までです`);
  const nightsRaw = input.nights === undefined || input.nights === "" ? days - 1 : Number(input.nights);
  if (!Number.isInteger(nightsRaw) || nightsRaw < 0 || nightsRaw > days - 1) throw new UserError(`泊数は0〜${days - 1}泊で入力してください`);
  return { destination, purpose, start, end, days, nights: nightsRaw, overseas: input.overseas === true || input.overseas === "true" || input.overseas === "on" };
}

export async function previewTrip(companyId: string, input: TripInput) {
  const policy = await getPolicy(companyId);
  if (!policy) throw new UserError("出張旅費規程(日当・宿泊費)がまだ決まっていません。管理者に設定を頼んでください");
  const t = parseTrip(input);
  return { ...t, ...calcTrip(policy, t.days, t.nights, t.overseas) };
}

// 出張を記録し、日当・宿泊費を経費精算に入れる(作成中の経費精算があればそこへ、なければ新しく作る)
export async function addTripToExpenses(user: Actor, input: TripInput) {
  const p = await previewTrip(user.companyId, input);
  if (p.allowance + p.lodging <= 0) throw new UserError("規程の金額が0円のため、経費精算に入れるものがありません");
  await ensureChartOfAccounts(user.companyId);
  const account = await prisma.account.findUniqueOrThrow({ where: { companyId_code: { companyId: user.companyId, code: TRAVEL_ACCOUNT } } });
  const report =
    (await prisma.expenseReport.findFirst({ where: { companyId: user.companyId, employeeId: user.id, approvalStatus: { in: ["DRAFT", "RETURNED"] }, reimbursedAt: null }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.expenseReport.create({ data: { companyId: user.companyId, employeeId: user.id, status: "DRAFT" } }));
  const label = `${p.destination}への出張(${p.start.replaceAll("-", "/")}${p.end !== p.start ? `〜${p.end.slice(5).replace("-", "/")}` : ""}・${p.purpose})`;
  const items = [
    p.allowance > 0 && { description: `日当 ${p.days}日分 ${label}`, amount: p.allowance },
    p.lodging > 0 && { description: `宿泊費 ${p.nights}泊分 ${label}`, amount: p.lodging },
  ].filter((x): x is { description: string; amount: number } => !!x);

  for (const it of items) {
    // 規程の定額なので AI の読み取りはなし(信頼度 1 として扱う)
    const extraction = await prisma.aiExtraction.create({
      data: { companyId: user.companyId, sourceType: "EXPENSE_ITEM", rawResponse: { source: "TRAVEL_POLICY", ...it }, confidence: 1, suggestedAccountCode: TRAVEL_ACCOUNT, status: "NEEDS_REVIEW" },
    });
    const item = await prisma.expenseItem.create({
      data: { expenseReportId: report.id, description: it.description.slice(0, 300), amount: it.amount, expenseDate: new Date(`${p.end}T00:00:00Z`), accountId: account.id, aiExtractionId: extraction.id },
    });
    await postExpenseItemJournal(item.id);
  }
  await prisma.expenseReport.update({ where: { id: report.id }, data: { totalAmount: { increment: p.allowance + p.lodging }, submittedAt: report.submittedAt ?? new Date() } });
  const trip = await prisma.travelTrip.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userName: user.name,
      destination: p.destination,
      purpose: p.purpose,
      startDate: new Date(`${p.start}T00:00:00Z`),
      endDate: new Date(`${p.end}T00:00:00Z`),
      nights: p.nights,
      overseas: p.overseas,
      allowance: p.allowance,
      lodging: p.lodging,
      expenseReportId: report.id,
    },
  });
  return { trip, reportId: report.id, total: p.allowance + p.lodging };
}

export async function listTrips(user: Actor) {
  const trips = await prisma.travelTrip.findMany({
    where: { companyId: user.companyId, ...(user.role === "EMPLOYEE" ? { userId: user.id } : {}) },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 100,
  });
  return trips.map((t) => ({ ...t, startDate: jstDateKey(t.startDate), endDate: jstDateKey(t.endDate) }));
}
