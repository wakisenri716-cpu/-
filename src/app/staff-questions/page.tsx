import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { listQuestions } from "@/lib/staffQuestions";
import QuestionsView from "./QuestionsView";

export const dynamic = "force-dynamic";

export default async function StaffQuestionsPage() {
  const companyId = await requireCompanyId();
  const [questions, ai] = await Promise.all([listQuestions(companyId), aiEnabled(companyId)]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">総務への質問箱</h1>
        <p className="mt-1 text-sm text-slate-600">
          従業員が「Clerkly従業員用」のAIに聞いてもわからなかったことが届きます。答えると本人にメールで知らせます。「よくある質問に足す」にすると、答えがマニュアル(よくある質問)に入り、次からは従業員のAIがそれを見て答えられます。
        </p>
      </div>
      <QuestionsView initial={JSON.parse(JSON.stringify(questions))} ai={ai} />
    </div>
  );
}
