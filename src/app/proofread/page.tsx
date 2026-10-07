import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import ProofreadView from "./ProofreadView";

export const dynamic = "force-dynamic";

export default async function ProofreadPage() {
  const companyId = await requireCompanyId();
  const ai = await aiEnabled(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">送る前の文章チェック</h1>
        <p className="mt-1 text-sm text-slate-600">
          メール・お知らせ・案内状などを送る前に貼り付けると、日付と曜日の食い違い、ありえない日付、二重敬語、「御中」と「様」の重ね、ら抜き言葉、同じ言葉の重なり、「拝啓」と「敬具」の対応、金額の桁区切りなどを確かめます。
          {ai ? "「AIでも見る」を使うと、失礼に読める言い回しやわかりにくい所も挙げ、直した全文を出します(数字や名前は変えません)。" : ""}
          文章は保存しません。
        </p>
      </div>
      <ProofreadView ai={ai} />
    </div>
  );
}
