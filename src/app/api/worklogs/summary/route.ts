import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { getWorkSummary, recalcMonth, setLaborCostRate } from "@/lib/workLogs";
import { csvResponse } from "@/lib/csv";
import { audit, yen } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// 会社全体の工数の集計(管理者・経理担当)。?format=csv で日報の一覧をCSVに
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const params = new URL(request.url).searchParams;
  const summary = await getWorkSummary(companyId, params.get("month"));
  if (params.get("format") === "csv") {
    return csvResponse(`日報_${summary.month}.csv`, [
      ["日付", "名前", "案件", "時間(分)", "時間単価", "労務費", "作業内容"],
      ...summary.logs.map((l) => [l.date, l.userName, l.projectName, l.minutes, l.hourlyCost, l.cost, l.task ?? ""]),
    ]);
  }
  return NextResponse.json(summary);
}

// { action: "rate", rate } 標準の時間単価 / { action: "recalc", month } 単価の付け直し
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    if (body.action === "rate") {
      const rate = await setLaborCostRate(companyId, body.rate);
      await audit("工数の標準の時間単価を変更", rate === null ? "なし" : yen(rate));
      return NextResponse.json({ rate });
    }
    if (body.action === "recalc") {
      const result = await recalcMonth(companyId, body.month);
      await audit("日報の時間単価を計算し直し", `${result.month} ${result.count}件`);
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "操作が正しくありません" }, { status: 400 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
