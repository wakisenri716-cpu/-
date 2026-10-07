import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { CONTRACT_KINDS, listContracts } from "@/lib/contracts";
import { formatYen } from "@/lib/format";
import { ContractsView } from "./ContractsView";

export const dynamic = "force-dynamic";

// 契約書の台帳
export default async function ContractsPage() {
  const companyId = await requireCompanyId();
  const data = await listContracts(companyId);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">契約書の台帳</h1>
        <p className="mt-1 text-sm text-slate-600">
          契約書(PDF・写真)を入れると、AIが相手・期間・自動更新・解約の申し出期限・金額・気をつける条項を読み取って台帳にします。AI受付箱に入れた契約書もここに載ります。解約の申し出期限(なければ満了日)が近づくと、ダッシュボードとカレンダーでお知らせします。
        </p>
        <p className="mt-2 text-sm">
          <Link href="/contracts/draft" className="text-indigo-700 hover:underline">
            契約書をひな形から作る(秘密保持・業務委託・取引基本)→
          </Link>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">有効な契約</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{data.contracts.filter((c) => c.status === "ACTIVE").length}件</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">毎月かかる金額(月額・年額÷12)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{formatYen(data.monthlyTotal)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">60日以内に判断が必要</div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${data.soon ? "text-amber-700" : ""}`}>{data.soon}件</div>
        </div>
      </div>
      <ContractsView contracts={JSON.parse(JSON.stringify(data.contracts))} kinds={CONTRACT_KINDS} />
    </div>
  );
}
