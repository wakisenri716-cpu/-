import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import { DRAFT_KINDS } from "@/lib/contractDrafts";
import ContractDraftView from "./ContractDraftView";

export const dynamic = "force-dynamic";

export default async function ContractDraftPage() {
  const companyId = await requireCompanyId();
  const ai = await aiEnabled(companyId);
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href="/contracts" className="text-sm text-indigo-700 hover:underline">
          ← 契約書の台帳
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">契約書のひな形</h1>
        <p className="mt-1 text-sm text-slate-600">
          秘密保持契約・業務委託契約・取引基本契約を、相手方と条件を入れて「第1条〜」の形で作ります。収入印紙・フリーランスへの委託(支払いは受け取りから60日以内など)の確かめる点も出します。AIを使うと、会社の事情に合わせて条文を直します(金額・日数・期間は変えません)。一般的なひな形なので、結ぶ前に弁護士などに確かめてください。
        </p>
      </div>
      <ContractDraftView kinds={DRAFT_KINDS} today={jstDateKey(new Date())} ai={ai} />
    </div>
  );
}
