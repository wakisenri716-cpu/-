import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { memoContext } from "@/lib/phoneMemos";
import { listApplicants } from "@/lib/applicants";
import ApplicantsView from "./ApplicantsView";

export const dynamic = "force-dynamic";

export default async function ApplicantsPage() {
  const companyId = await requireCompanyId();
  const [data, ctx, ai] = await Promise.all([listApplicants(companyId), memoContext(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">採用の応募者</h1>
        <p className="mt-1 text-sm text-slate-600">
          「鈴木 一郎 ホールスタッフ Indeed 090-1234-5678」のように1行で書くと、名前・応募した仕事・応募経路・電話・メールに分けて記録します。面接の日時を入れると<Link href="/visitors" className="text-indigo-700 underline">来客の受付簿</Link>にも予定が入り、面接のご案内・内定・不採用のメールを下書きして送れます{ai ? "(AIで文をととのえることもできます)" : ""}。不採用・辞退から6か月たった応募者の情報は、まとめて消せます。求人票は<Link href="/job-posting" className="text-indigo-700 underline">求人票の下書き</Link>で作れます。
        </p>
      </div>
      <ApplicantsView initial={JSON.parse(JSON.stringify(data))} users={ctx.users.map((u) => ({ id: u.id, name: u.name }))} ai={ai} />
    </div>
  );
}
