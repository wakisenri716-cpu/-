import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { addItemsToExpenses } from "@/lib/expenseQuickAdd";

// 交通費精算: よく使う経路(出発・到着・経由・片道の運賃・往復か)を本人ごとに登録し、乗った日を選ぶだけで
// 1日1行の明細として経費精算(旅費交通費)に入れる。

type Actor = { id: string; companyId: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROUTES = 50;
const MAX_DAYS = 31;

const text = (v: unknown, label: string, max: number, required = true) => {
  const s = String(v ?? "").trim().slice(0, max);
  if (required && !s) throw new UserError(`${label}を入力してください`);
  return s;
};

function parseRoute(input: Record<string, unknown>) {
  const fromPlace = text(input.fromPlace, "出発", 40);
  const toPlace = text(input.toPlace, "到着", 40);
  const fare = Number(String(input.fare ?? "").normalize("NFKC").replace(/[,¥円\s]/g, ""));
  if (!Number.isInteger(fare) || fare < 1 || fare > 100_000) throw new UserError("片道の運賃は1〜100,000円の整数で入力してください");
  return {
    fromPlace,
    toPlace,
    via: text(input.via, "経由", 40, false) || null,
    name: text(input.name, "名前", 40, false) || `${fromPlace}→${toPlace}`,
    fare,
    roundTrip: input.roundTrip !== false && input.roundTrip !== "false",
  };
}

export async function listRoutes(user: Actor) {
  const [routes, recent] = await Promise.all([
    prisma.transportRoute.findMany({ where: { companyId: user.companyId, userId: user.id }, orderBy: { createdAt: "asc" } }),
    prisma.expenseItem.findMany({
      where: { expenseReport: { companyId: user.companyId, employeeId: user.id }, aiExtraction: { rawResponse: { path: ["source"], equals: "TRANSPORT" } } },
      orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
      take: 30,
      select: { id: true, description: true, amount: true, expenseDate: true, expenseReport: { select: { approvalStatus: true, reimbursedAt: true } } },
    }),
  ]);
  return {
    today: jstDateKey(new Date()),
    routes,
    recent: recent.map((r) => ({ id: r.id, description: r.description, amount: r.amount, date: r.expenseDate ? jstDateKey(r.expenseDate) : null, reimbursed: !!r.expenseReport.reimbursedAt })),
  };
}

export async function addRoute(user: Actor, input: Record<string, unknown>) {
  if ((await prisma.transportRoute.count({ where: { companyId: user.companyId, userId: user.id } })) >= MAX_ROUTES) throw new UserError(`経路は${MAX_ROUTES}件まで登録できます`);
  return prisma.transportRoute.create({ data: { companyId: user.companyId, userId: user.id, ...parseRoute(input) } });
}

export async function updateRoute(user: Actor, id: string, input: Record<string, unknown>) {
  const route = await prisma.transportRoute.findFirst({ where: { id, companyId: user.companyId, userId: user.id } });
  if (!route) throw new UserError("経路が見つかりません");
  return prisma.transportRoute.update({ where: { id }, data: parseRoute({ ...route, ...input }) });
}

export async function deleteRoute(user: Actor, id: string) {
  const route = await prisma.transportRoute.findFirst({ where: { id, companyId: user.companyId, userId: user.id } });
  if (!route) throw new UserError("経路が見つかりません");
  await prisma.transportRoute.delete({ where: { id } });
  return route;
}

// { routeId, dates: [YYYY-MM-DD], oneWay, purpose } 乗った日ごとに1行ずつ経費精算に入れる
export async function addRides(user: Actor, input: { routeId?: unknown; dates?: unknown; oneWay?: unknown; purpose?: unknown }) {
  const route = await prisma.transportRoute.findFirst({ where: { id: String(input.routeId ?? ""), companyId: user.companyId, userId: user.id } });
  if (!route) throw new UserError("経路を選んでください");
  const today = jstDateKey(new Date());
  const dates = [...new Set((Array.isArray(input.dates) ? input.dates : []).map(String))].sort();
  if (dates.length === 0) throw new UserError("乗った日を選んでください");
  if (dates.length > MAX_DAYS) throw new UserError(`一度に入れられるのは${MAX_DAYS}日分までです`);
  for (const d of dates) {
    if (!DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) throw new UserError("乗った日が正しくありません");
    if (d > today) throw new UserError("これから先の日は選べません");
  }
  const purpose = text(input.purpose, "目的", 60, false);
  const both = route.roundTrip && input.oneWay !== true && input.oneWay !== "true";
  const amount = route.fare * (both ? 2 : 1);
  const path = `${route.fromPlace}${route.via ? `(${route.via}経由)` : ""}${both ? "⇔" : "→"}${route.toPlace}`;
  const items = dates.map((d) => ({ description: `交通費 ${path}${both ? " 往復" : " 片道"}${purpose ? `(${purpose})` : ""}`, amount, date: d }));
  return addItemsToExpenses(user, items, "TRANSPORT");
}
