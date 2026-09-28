import type { DealStage } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { jstDateKey } from "@/lib/jst";
import { createProject } from "@/lib/accounting/projects";

// 商談管理: 受注までの見込みを段階ごとに並べ、見込みの売上(確度をかけた額)と次にやることを管理する

export const STAGES: { key: DealStage; label: string; probability: number; open: boolean }[] = [
  { key: "LEAD", label: "見込み", probability: 20, open: true },
  { key: "PROPOSAL", label: "提案中", probability: 40, open: true },
  { key: "QUOTED", label: "見積提出", probability: 70, open: true },
  { key: "WON", label: "受注", probability: 100, open: false },
  { key: "LOST", label: "失注", probability: 0, open: false },
];
const STAGE = new Map(STAGES.map((s) => [s.key, s]));
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DealInput = {
  title?: unknown;
  customerName?: unknown;
  amount?: unknown;
  stage?: unknown;
  probability?: unknown;
  expectedClose?: unknown;
  nextAction?: unknown;
  nextActionDate?: unknown;
  ownerName?: unknown;
  notes?: unknown;
  lostReason?: unknown;
};

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

function parse(input: DealInput) {
  const amount = Number(String(input.amount ?? "0").replaceAll(",", "") || 0);
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000_000) throw new UserError("見込みの金額は0以上の整数(円)で入力してください");
  const stage = String(input.stage ?? "LEAD") as DealStage;
  if (!STAGE.has(stage)) throw new UserError("段階を選んでください");
  const rawProbability = String(input.probability ?? "").trim();
  const probability = rawProbability === "" ? null : Number(rawProbability);
  if (probability !== null && (!Number.isInteger(probability) || probability < 0 || probability > 100)) throw new UserError("確度は0〜100(%)で入力してください");
  return {
    title: text(input.title, 80, "商談名", true)!,
    customerName: text(input.customerName, 100, "顧客", true)!,
    amount,
    stage,
    probability,
    expectedClose: date(input.expectedClose, "受注の見込み日"),
    nextAction: text(input.nextAction, 100, "次にやること"),
    nextActionDate: date(input.nextActionDate, "次にやる日"),
    ownerName: text(input.ownerName, 40, "担当者"),
    notes: text(input.notes, 1000, "メモ"),
    lostReason: text(input.lostReason, 200, "失注の理由"),
  };
}

// 受注・失注にしたときは、その日を記録する(元に戻したら消す)
function closedAtFor(stage: DealStage, current: Date | null) {
  return STAGE.get(stage)!.open ? null : (current ?? new Date());
}

export async function createDeal(companyId: string, input: DealInput) {
  const data = parse(input);
  return prisma.deal.create({ data: { companyId, ...data, closedAt: closedAtFor(data.stage, null) } });
}

const FIELDS = ["title", "customerName", "amount", "stage", "probability", "expectedClose", "nextAction", "nextActionDate", "ownerName", "notes", "lostReason"] as const;

// 送られてきた項目だけ変える(段階だけの移動など)
export async function updateDeal(companyId: string, id: string, input: DealInput) {
  const deal = await prisma.deal.findFirst({ where: { id, companyId } });
  if (!deal) throw new UserError("商談が見つかりません");
  const key = (d: Date | null) => (d ? jstDateKey(d) : "");
  const current: DealInput = {
    ...deal,
    expectedClose: key(deal.expectedClose),
    nextActionDate: key(deal.nextActionDate),
    probability: deal.probability ?? "",
  };
  const merged = Object.fromEntries(FIELDS.map((f) => [f, input[f] === undefined ? current[f] : input[f]])) as DealInput;
  const data = parse(merged);
  return prisma.deal.update({ where: { id }, data: { ...data, closedAt: closedAtFor(data.stage, deal.stage === data.stage ? deal.closedAt : null) } });
}

export async function deleteDeal(companyId: string, id: string) {
  const deal = await prisma.deal.findFirst({ where: { id, companyId } });
  if (!deal) throw new UserError("商談が見つかりません");
  await prisma.deal.delete({ where: { id } });
  return deal;
}

// 受注した商談から、案件別損益の案件を作る(受注額を受注額の予算に)
export async function createProjectFromDeal(companyId: string, id: string) {
  const deal = await prisma.deal.findFirst({ where: { id, companyId } });
  if (!deal) throw new UserError("商談が見つかりません");
  if (deal.stage !== "WON") throw new UserError("受注した商談だけ案件にできます");
  if (deal.projectId) throw new UserError("この商談はすでに案件にしています");
  // 同じ名前の案件があれば、後ろに番号を付ける
  let name = deal.title.slice(0, 46);
  for (let i = 2; await prisma.project.findFirst({ where: { companyId, name } }); i++) name = `${deal.title.slice(0, 44)}(${i})`;
  const project = await createProject(companyId, { name, customerName: deal.customerName, budgetRevenue: String(deal.amount || ""), startDate: jstDateKey(new Date()) });
  await prisma.deal.update({ where: { id }, data: { projectId: project.id } });
  return project;
}

export function probabilityOf(deal: { stage: DealStage; probability: number | null }) {
  return deal.probability ?? STAGE.get(deal.stage)!.probability;
}

export async function getPipeline(companyId: string, now = new Date()) {
  const today = jstDateKey(now);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 90 * 86_400_000);
  const deals = await prisma.deal.findMany({
    // 受注・失注は直近90日に決まったものだけ出す
    where: { companyId, OR: [{ stage: { in: ["LEAD", "PROPOSAL", "QUOTED"] } }, { closedAt: { gte: since } }] },
    include: { project: { select: { id: true, name: true } } },
    orderBy: [{ nextActionDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
  });
  const rows = deals.map((d) => ({
    id: d.id,
    title: d.title,
    customerName: d.customerName,
    amount: d.amount,
    stage: d.stage,
    probability: probabilityOf(d),
    probabilitySet: d.probability !== null,
    expectedClose: d.expectedClose ? jstDateKey(d.expectedClose) : null,
    nextAction: d.nextAction,
    nextActionDate: d.nextActionDate ? jstDateKey(d.nextActionDate) : null,
    overdue: STAGE.get(d.stage)!.open && !!d.nextActionDate && jstDateKey(d.nextActionDate) <= today,
    ownerName: d.ownerName,
    notes: d.notes,
    lostReason: d.lostReason,
    closedAt: d.closedAt ? jstDateKey(d.closedAt) : null,
    project: d.project,
  }));
  const open = rows.filter((r) => STAGE.get(r.stage)!.open);
  const won = rows.filter((r) => r.stage === "WON");
  const lost = rows.filter((r) => r.stage === "LOST");
  const month = today.slice(0, 7);
  return {
    stages: STAGES,
    deals: rows,
    summary: {
      openCount: open.length,
      openAmount: open.reduce((s, r) => s + r.amount, 0),
      // 見込みの売上: 金額 × 確度
      weighted: Math.round(open.reduce((s, r) => s + (r.amount * r.probability) / 100, 0)),
      wonThisMonth: won.filter((r) => r.closedAt?.startsWith(month)).reduce((s, r) => s + r.amount, 0),
      // 直近90日の受注率(件数)
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      overdue: open.filter((r) => r.overdue).length,
    },
  };
}

// 次にやる日が今日までの、進行中の商談(やることリスト用)
export function countDueDeals(companyId: string, now = new Date()) {
  return prisma.deal.count({
    where: { companyId, stage: { in: ["LEAD", "PROPOSAL", "QUOTED"] }, nextActionDate: { lte: new Date(`${jstDateKey(now)}T00:00:00Z`) } },
  });
}
