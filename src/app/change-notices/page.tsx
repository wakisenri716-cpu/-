import { requireCompanyId } from "@/lib/auth/session";
import { listNotices } from "@/lib/changeNotices";
import NoticesView from "./NoticesView";

export const dynamic = "force-dynamic";

export default async function ChangeNoticesPage() {
  const companyId = await requireCompanyId();
  const rows = await listNotices(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">身上の変更の届け出</h1>
        <p className="mt-1 text-sm text-slate-600">
          従業員が「身上の変更の届け出」から住所・電話番号・名前・緊急連絡先の変更を届けると、メールで届きます。いまの名簿の中身と見くらべて「名簿に入れる」を押すと労働者名簿に入り、あわせて確かめること(通勤手当・社会保険の届けなど)を出します。結果は本人にメールで知らせます。
        </p>
      </div>
      <NoticesView initial={JSON.parse(JSON.stringify(rows))} />
    </div>
  );
}
