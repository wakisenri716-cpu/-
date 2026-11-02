import { requireCompanyId } from "@/lib/auth/session";
import { memoContext } from "@/lib/phoneMemos";
import { listLicenses } from "@/lib/staffLicenses";
import LicensesView from "./LicensesView";

export const dynamic = "force-dynamic";

export default async function LicensesPage() {
  const companyId = await requireCompanyId();
  const [data, ctx] = await Promise.all([listLicenses(companyId), memoContext(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">資格・免許の管理</h1>
        <p className="mt-1 text-sm text-slate-600">
          「山田 花子 普通自動車免許 2028/3/31まで」のように1行で書いて「読み取る」を押すと、持っている人・資格や免許の名前・有効期限に分けて記録します(令和10年3月31日・R10.3.31 も読みます)。有効期限の60日前から、ここと やることリストで知らせます。社用車を運転した人(この90日のアルコールチェックの記録)で、運転免許の記録がない・切れている人も知らせます。
        </p>
      </div>
      <LicensesView initial={JSON.parse(JSON.stringify(data))} users={ctx.users.map((u) => ({ id: u.id, name: u.name }))} />
    </div>
  );
}
