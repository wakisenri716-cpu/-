import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { createProject, getProjectSummaries, listActiveProjects } from "@/lib/accounting/projects";
import { getFiscalStartMonth, resolvePeriod, toRange } from "@/lib/accounting/period";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const params = Object.fromEntries(new URL(request.url).searchParams);
  // 入力画面の選択肢用: 進行中の案件の名前だけ
  if (params.list) return NextResponse.json(await listActiveProjects(companyId));
  // 案件は期をまたぐことが多いので、既定は「すべての期間」
  const period = resolvePeriod({ preset: params.from || params.to ? undefined : "all", ...params }, await getFiscalStartMonth(companyId));
  return NextResponse.json({ period, ...(await getProjectSummaries(companyId, toRange(period))) });
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const project = await createProject(companyId, body);
    await audit("案件を登録", project.name);
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
