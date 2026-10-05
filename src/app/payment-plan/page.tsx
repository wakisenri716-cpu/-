import { requireCompanyId } from "@/lib/auth/session";
import { getPaymentPlan } from "@/lib/paymentPlan";
import { PaymentPlanView } from "./PaymentPlanView";

export const dynamic = "force-dynamic";

// 支払計画(この先2週間の支払いを、現預金と入金予測で払えるか確かめる)
export default async function PaymentPlanPage({ searchParams }: { searchParams: Promise<{ buffer?: string }> }) {
  const companyId = await requireCompanyId();
  const raw = (await searchParams).buffer;
  const plan = await getPaymentPlan(companyId, raw && /^\d+$/.test(raw) ? Number(raw) : null);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">支払計画</h1>
        <p className="mt-1 text-sm text-slate-600">
          この先2週間に支払期限が来る請求書(期限切れを含む)を、いまの現預金と入金予測の入金で払えるか日ごとに確かめ、「支払う」と「支払日をずらす相談をする」に分けます。払うと手元に残したい金額を下回るものが「ずらす相談」になります。給料・税金・定期取引などの支払いは含まないので、その分は手元に残したい金額で見込んでください。
        </p>
      </div>
      <PaymentPlanView initial={plan} />
    </div>
  );
}
