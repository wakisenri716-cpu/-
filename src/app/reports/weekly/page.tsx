import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import { defaultWeek, mondayOf } from "@/lib/weeklyReport";
import WeeklyView from "./WeeklyView";

export const dynamic = "force-dynamic";

export default async function WeeklyReportPage() {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const ai = await aiEnabled(companyId);
  const today = jstDateKey(new Date());
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-semibold">AIの週報</h1>
        <p className="mt-1 text-sm text-slate-600">
          1週間(月〜日)に済んだやること・日報の作業時間・請求と入金・見積・受注・伝言を集めて、週報にします。来週が期限のやることと、期限を過ぎたやること・請求書も載せます。
          {ai
            ? "「AIで書く」を押すと、冒頭のひとことと来週の重点をAIが書きます(週報にない数字は書かせません)。"
            : ""}
          本文は直してから、コピー・印刷・社内のお知らせに載せられます。
        </p>
      </div>
      <WeeklyView
        initialWeek={defaultWeek(today)}
        thisWeek={mondayOf(today)}
        ai={ai}
        canPost={user.role === "ADMIN" || user.role === "ACCOUNTANT"}
      />
    </div>
  );
}
