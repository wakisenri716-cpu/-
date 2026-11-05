import { requireCompanyId } from "@/lib/auth/session";
import { listPhonebook } from "@/lib/phonebook";
import PhonebookView from "./PhonebookView";

export const dynamic = "force-dynamic";

export default async function PhonebookPage() {
  const companyId = await requireCompanyId();
  const data = await listPhonebook(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">社内の電話帳(内線表)</h1>
        <p className="mt-1 text-sm text-slate-600">
          「山田 花子 経理 内線201 携帯 090-1234-5678」「受付 100」のように1行に1人(1か所)ずつ書くか、Excelの表をそのまま貼り付けると、名前・部署・内線・直通・社用携帯に分けて入れます。同じ名前は新しい番号に入れかえます。従業員はスマホの「その他」→「社内の電話帳」から見られます。
        </p>
      </div>
      <PhonebookView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
