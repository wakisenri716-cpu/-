import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { getHrProcedures } from "@/lib/hrProcedures";
import HrProceduresView from "./HrProceduresView";

export const dynamic = "force-dynamic";

export default async function HrProceduresPage() {
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([getHrProcedures(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">入社・退職の手続き</h1>
        <p className="mt-1 text-sm text-slate-600">
          労働者名簿に入れた入社日・退職日から、社会保険・雇用保険の届出、住民税、源泉徴収票、備品の返却などを期限つきで並べます。振込先の登録・備品の返却・ログインの停止などは、データから自動で「済み」になります。本人に送る案内文も作れます。期限は一般的な目安です。土日祝の扱いや個別の事情は、年金事務所・ハローワーク・社労士に確かめてください。
        </p>
      </div>
      <HrProceduresView initial={data} ai={ai} />
    </div>
  );
}
