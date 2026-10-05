import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { cancelConsumptionTaxClose, getConsumptionTaxClose, postConsumptionTaxClose } from "@/lib/accounting/consumptionTaxClose";
import { audit } from "@/lib/audit";

const yearOf = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));

// ?fy=年度 の消費税の決算整理の計算
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => getConsumptionTaxClose(companyId, yearOf(new URL(request.url).searchParams.get("fy"))));
}

// { fy } 期末の日付で決算整理の仕訳を作る(前に作った仕訳は取消にして作り直す)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await postConsumptionTaxClose(companyId, user, yearOf(body.fy));
    await audit("消費税の決算整理", `${r.fiscalYear}年度 納付 ${r.total.toLocaleString()}円`);
    return r;
  });
}

// ?fy=年度 の決算整理を取り消す
export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  const fy = Number(new URL(request.url).searchParams.get("fy"));
  return respond(async () => {
    await cancelConsumptionTaxClose(companyId, fy);
    await audit("消費税の決算整理の取消", `${fy}年度`);
    return { ok: true };
  });
}
