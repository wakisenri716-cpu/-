import { requireCompanyId } from "@/lib/auth/session";
import { listChecks } from "@/lib/safetyChecks";
import SafetyView from "./SafetyView";

export const dynamic = "force-dynamic";

export default async function SafetyPage() {
  const companyId = await requireCompanyId();
  const checks = await listChecks(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">安否確認</h1>
        <p className="mt-1 text-sm text-slate-600">
          地震・台風などのとき、社員全員に「無事か」「出社できるか」をメールとアプリの通知で聞きます。答えはボタンで選ぶだけです。助けが必要な人・けがをした人・まだ答えていない人を先に出し、まだの人にはもう一度送れます。AIが使えるときは、知らせる文を整え、答えのひとことをまとめます。
        </p>
      </div>
      <SafetyView initial={JSON.parse(JSON.stringify(checks))} />
    </div>
  );
}
