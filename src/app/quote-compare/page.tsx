import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { prisma } from "@/lib/prisma";
import QuoteCompareView from "./QuoteCompareView";

export const dynamic = "force-dynamic";

export default async function QuoteComparePage() {
  const companyId = await requireCompanyId();
  const [ai, vendors] = await Promise.all([
    aiEnabled(companyId),
    prisma.vendor.findMany({ where: { companyId }, select: { name: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/purchase-orders" className="text-sm text-indigo-700 hover:underline">
          ← 発注書
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">相見積の比較</h1>
        <p className="mt-1 text-sm text-slate-600">
          仕入先から届いた見積(メールの本文やPDFの文字)を2〜5社分貼って「比べる」を押すと、税込の合計・品目ごとの単価・納期・支払条件を並べて、いちばん安い見積と差額を出します。税込と税抜が混ざっていてもそろえて比べます。
          {ai ? "形のそろっていない見積は「AIで読み取る」を使うと、明細を読み取ります(見積に書いていない数字は使いません)。" : ""}
          選んだ見積からそのまま発注書を作れます。比べた内容は保存しません。
        </p>
      </div>
      <QuoteCompareView ai={ai} vendors={vendors.map((v) => v.name)} />
    </div>
  );
}
