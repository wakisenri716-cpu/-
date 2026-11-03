import { requireCompanyId } from "@/lib/auth/session";
import { listSurveys } from "@/lib/surveys";
import SurveysView from "./SurveysView";

export const dynamic = "force-dynamic";

export default async function SurveysPage() {
  const companyId = await requireCompanyId();
  const surveys = await listSurveys(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">社内アンケート</h1>
        <p className="mt-1 text-sm text-slate-600">
          何を聞きたいかを1行で書くと、質問の案を作ります(AIが使えるときは「AIで質問を考える」)。直してから社員に送ると、メールとアプリの通知で知らせ、答えを集計します。名前を出さないアンケートでは、集計に名前を出さず、自由に書いた答えは3人以上答えるまで見せません。健康・思想・家族など大切な個人情報を聞く質問は使えません。
        </p>
      </div>
      <SurveysView initial={JSON.parse(JSON.stringify(surveys))} />
    </div>
  );
}
