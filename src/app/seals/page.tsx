import { requireCompanyId } from "@/lib/auth/session";
import { listSeals } from "@/lib/sealUses";
import SealsView from "./SealsView";

export const dynamic = "force-dynamic";

export default async function SealsPage() {
  const companyId = await requireCompanyId();
  const data = await listSeals(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">押印の申請と押印簿</h1>
        <p className="mt-1 text-sm text-slate-600">
          「さくら商事との業務委託契約書 2部 実印」のように1行で書くと、印の種類・書類・相手先・部数に分けます(印を書かなければ、契約書・委任状は実印、請求書・見積書は角印とみます)。従業員の申請は管理者にメールで届き、認める・押した・見送りを押印簿に残します。実印と銀行印は、頼んだ本人は認められません(管理者がひとりのときは「自分で認めた」と残します)。
        </p>
      </div>
      <SealsView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
