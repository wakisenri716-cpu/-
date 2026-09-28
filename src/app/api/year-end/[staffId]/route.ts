import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { finalizeYearEnd, getYearEndStaff, saveYearEndInputs, unfinalizeYearEnd } from "@/lib/payroll/yearEnd";
import { respond } from "@/lib/shifts/http";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

type Params = { params: Promise<{ staffId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { staffId } = await params;
  const companyId = await requireCompanyId();
  try {
    const data = await getYearEndStaff(companyId, staffId, new URL(request.url).searchParams.get("year"));
    if (!data) return NextResponse.json({ error: "スタッフが見つかりません" }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

// 申告の内容を保存: { year, inputs }
export async function PUT(request: Request, { params }: Params) {
  const { staffId } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await saveYearEndInputs(companyId, staffId, body.year, body.inputs);
    await audit("年末調整の申告を保存", `${r.year}年 ${r.staff.name}`);
    return { ok: true };
  });
}

// 確定・確定の取消し: { action: "finalize" | "unfinalize", year }
export async function POST(request: Request, { params }: Params) {
  const { staffId } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  if (body.action !== "finalize" && body.action !== "unfinalize") return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
  return respond(async () => {
    if (body.action === "finalize") {
      const r = await finalizeYearEnd(companyId, staffId, body.year);
      const d = r.result.difference;
      await audit("年末調整を確定", `${r.year}年 ${r.staff.name} 年税額${yen(r.result.annualTax)} ${d >= 0 ? `還付${yen(d)}` : `徴収${yen(-d)}`}`);
      return r.result;
    }
    const r = await unfinalizeYearEnd(companyId, staffId, body.year);
    await audit("年末調整の確定を取消し", `${r.year}年 ${r.staff.name}`);
    return { ok: true };
  });
}
