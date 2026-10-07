import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { DOC_CATEGORIES, DOC_TOOLS, getDocUsage } from "@/lib/docHub";
import DocHubView from "./DocHubView";

export const dynamic = "force-dynamic";

export default async function AiDocsPage() {
  const companyId = await requireCompanyId();
  const [usage, ai] = await Promise.all([getDocUsage(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">AIで書類を作る</h1>
        <p className="mt-1 text-sm text-slate-600">
          挨拶状・契約書・規程・求人票・議事録・マニュアル・督促文など、書類づくりの画面をまとめました。作りたいものを下の欄に入れると絞り込めます。{ai ? "AIの印があるものは、AIが会社の事情に合わせて書き直します。" : "AIの設定をすると、AIの印があるものは会社の事情に合わせて書き直せます(なくてもひな形で作れます)。"}
        </p>
      </div>
      <DocHubView tools={DOC_TOOLS} categories={DOC_CATEGORIES} usage={usage} />
    </div>
  );
}
