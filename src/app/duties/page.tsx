import { requireCompanyId } from "@/lib/auth/session";
import { listDuties } from "@/lib/duties";
import DutiesView from "./DutiesView";

export const dynamic = "force-dynamic";

export default async function DutiesPage() {
  const companyId = await requireCompanyId();
  const data = await listDuties(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">当番表</h1>
        <p className="mt-1 text-sm text-slate-600">
          「掃除 月水金 山田・佐藤・鈴木」「電話当番 平日 経理・山田」のように1行で書くと、当番の名前・曜日・する人(書いた順)に分けます。その曜日の会社が開いている日(土日・祝日・会社の休業日を除く)に順番に回し、当番の日の朝に本人へメールとアプリの通知で知らせます。その日だけの入れかわりもできます。
        </p>
      </div>
      <DutiesView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
