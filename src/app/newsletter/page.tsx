import { requireCompanyId } from "@/lib/auth/session";
import { jstDateKey } from "@/lib/jst";
import NewsletterView from "./NewsletterView";

export const dynamic = "force-dynamic";

export default async function NewsletterPage() {
  await requireCompanyId();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">社内報の下書き</h1>
        <p className="mt-1 text-sm text-slate-600">
          月を選ぶと、その月の誕生日・入社の記念日・新しく入った人・社内のイベント・会社のお休みを集めて、社内報の下書きを作ります。総務からのひとことも足せます。AIを使うと、材料にある名前・日付だけで読みやすい文に整えます。できたら直して、社内のお知らせに出せます。
        </p>
      </div>
      <NewsletterView month={jstDateKey(new Date()).slice(0, 7)} />
    </div>
  );
}
