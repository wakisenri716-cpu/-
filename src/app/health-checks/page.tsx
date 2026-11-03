import { requireCompanyId } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { listHealth } from "@/lib/healthChecks";
import { jstDateKey } from "@/lib/jst";
import HealthView from "./HealthView";

export const dynamic = "force-dynamic";

export default async function HealthChecksPage() {
  const companyId = await requireCompanyId();
  const year = Number(jstDateKey(new Date()).slice(0, 4));
  const [data, staff] = await Promise.all([listHealth(companyId, year), prisma.staff.findMany({ where: { companyId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">健康診断の受診管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          「山田 11/20 健診 さくらクリニック 8,800円」「佐藤 受けた 再検査あり」のように1行で書いて「読み取る」を押すと、受ける人・予約日か受けた日・病院・費用に分けて記録します。会社は1年に1回、社員に健康診断を受けてもらう決まりです。今年まだの人・1年以上受けていない人・予約日を過ぎたのに受けた記録がない人・再検査がまだの人を、ここと やることリストで知らせます。
        </p>
        <p className="mt-1 text-xs text-slate-500">健康のことは大切な個人情報なので、結果の中身(病名・数値)は記録しません。受けた日と「再検査が必要か」だけを残します。</p>
      </div>
      <HealthView initial={JSON.parse(JSON.stringify(data))} staff={staff} />
    </div>
  );
}
