import Link from "next/link";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getPolicy } from "@/lib/travel";
import { jstDateKey } from "@/lib/jst";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

function jpDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}
const yen = (n: number) => `${n.toLocaleString()}円`;

// 出張旅費規程(文書)。設定した日当・宿泊費の金額で作り、A4で印刷して保管する
export default async function TravelPolicyPage() {
  const user = await requireMember();
  const [policy, company] = await Promise.all([getPolicy(user.companyId), prisma.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true } })]);
  if (!policy) redirect("/travel");
  const effective = jpDate(jstDateKey(policy.effectiveDate ?? policy.updatedAt));
  const hasOverseas = policy.overseasDaily > 0 || policy.overseasLodging > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/travel" className="text-sm text-indigo-700 hover:underline">
          ← 出張旅費・日当
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-3xl space-y-5 rounded-xl border border-slate-200 bg-white p-6 text-sm leading-7 shadow-sm sm:p-10 print:border-0 print:p-0 print:shadow-none">
        <h1 className="text-center text-xl font-semibold tracking-widest">出張旅費規程</h1>
        <p className="text-right">{company.name}</p>

        <section>
          <h2 className="font-semibold">第1条(目的)</h2>
          <p>この規程は、役員および従業員(以下「出張者」という)が会社の業務のために出張するときの旅費の支給について定める。</p>
        </section>
        <section>
          <h2 className="font-semibold">第2条(出張の定義)</h2>
          <p>この規程で出張とは、通常の勤務地を離れて業務を行うことをいい、宿泊を伴わないものを日帰り出張、宿泊を伴うものを宿泊出張、国外へのものを海外出張という。</p>
        </section>
        <section>
          <h2 className="font-semibold">第3条(旅費の種類)</h2>
          <p>旅費は、交通費・日当・宿泊費とする。</p>
        </section>
        <section>
          <h2 className="font-semibold">第4条(交通費)</h2>
          <p>交通費は、もっとも経済的かつ合理的な経路と方法による実費を支給する。出張者は領収書などの証憑を提出する。</p>
        </section>
        <section>
          <h2 className="font-semibold">第5条(日当・宿泊費)</h2>
          <p>日当および宿泊費は、役職にかかわらず、次の定額を支給する。宿泊費は実際の宿泊料の額にかかわらず定額とする。</p>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-400 px-3 py-1.5 text-left font-medium">区分</th>
                <th className="border border-slate-400 px-3 py-1.5 text-right font-medium">日当(1日)</th>
                <th className="border border-slate-400 px-3 py-1.5 text-right font-medium">宿泊費(1泊)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-slate-400 px-3 py-1.5">日帰り出張</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right tabular-nums">{yen(policy.dayTripAllowance)}</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right">−</td>
              </tr>
              <tr>
                <td className="border border-slate-400 px-3 py-1.5">宿泊出張</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right tabular-nums">{yen(policy.dailyAllowance)}</td>
                <td className="border border-slate-400 px-3 py-1.5 text-right tabular-nums">{yen(policy.lodging)}</td>
              </tr>
              {hasOverseas && (
                <tr>
                  <td className="border border-slate-400 px-3 py-1.5">海外出張</td>
                  <td className="border border-slate-400 px-3 py-1.5 text-right tabular-nums">{yen(policy.overseasDaily)}</td>
                  <td className="border border-slate-400 px-3 py-1.5 text-right tabular-nums">{yen(policy.overseasLodging)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="mt-2">日当は出発日から帰着日までの日数分、宿泊費は泊数分を支給する。</p>
        </section>
        <section>
          <h2 className="font-semibold">第6条(精算)</h2>
          <p>出張者は、出張から戻ったのち速やかに、行き先・目的・期間を記載して旅費を精算する。</p>
        </section>
        <section>
          <h2 className="font-semibold">第7条(改廃)</h2>
          <p>この規程の改廃は、取締役会(取締役会を置かない会社では株主総会または代表者)の決定による。</p>
        </section>
        <section>
          <h2 className="font-semibold">附則</h2>
          <p>この規程は、{effective}から施行する。</p>
        </section>
      </article>
    </div>
  );
}
