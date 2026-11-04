import { requireCompanyId } from "@/lib/auth/session";
import { listCards } from "@/lib/cardOrders";
import CardsAdmin from "./CardsAdmin";

export const dynamic = "force-dynamic";

export default async function CardsPage() {
  const companyId = await requireCompanyId();
  const data = await listCards(companyId);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">名刺の注文</h1>
        <p className="mt-1 text-sm text-slate-600">
          従業員が「名刺の注文」から申し込むとメールで届きます。申し込みを選んで、印刷会社にまとめてメールで頼めます(一人ずつの名前・役職・連絡先・英語の表記・枚数を並べます)。届いたら「届いた」で本人に知らせます。裏面の英語の名前は、ふりがなからローマ字(ヘボン式)に決まった方法で直し、役職・部署はAIが使えるときはAIが英語にします。
        </p>
      </div>
      <CardsAdmin initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
