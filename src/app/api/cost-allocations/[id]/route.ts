import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteCostAllocation, previewCostAllocation, runCostAllocation, updateCostAllocation } from "@/lib/accounting/costAllocation";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// ?month=YYYY-MM の配賦の見込み
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(() => previewCostAllocation(companyId, id, new URL(request.url).searchParams.get("month")));
}

// { month } でその月を配賦する
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const run = await runCostAllocation(companyId, id, body.month);
    await audit("部門配賦を実行", `${run.month} ${run.amount.toLocaleString()}円`);
    return run;
  }, 201);
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const a = await updateCostAllocation(companyId, id, body);
    await audit("部門配賦の設定を変更", `${a.name}${a.active ? "" : "(停止)"}`);
    return a;
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const a = await deleteCostAllocation(companyId, id);
    await audit("部門配賦の設定を削除", a.name);
    return { ok: true };
  });
}
