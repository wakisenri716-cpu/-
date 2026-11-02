import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { jstDateKey } from "@/lib/jst";
import { listGifts } from "@/lib/gifts";
import GiftsView from "./GiftsView";

export const dynamic = "force-dynamic";

export default async function GiftsPage() {
  const companyId = await requireCompanyId();
  const year = Number(jstDateKey(new Date()).slice(0, 4));
  const data = await listGifts(companyId, year);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">贈答品の記録(お歳暮・お中元)</h1>
        <p className="mt-1 text-sm text-slate-600">
          「さくら商事からお歳暮 洋菓子の詰め合わせ」「さくら商事へお歳暮 ハム 5,400円」のように1行で書くと、いただいた・送った・相手・品物・金額に分けて記録します。いただいたものは「お礼状を作る」から<Link href="/letters/greeting" className="text-indigo-700 underline">お礼状</Link>の下書きへ進め、お礼がまだのものはやることリストで知らせます。去年送ったのに今年まだの相手、いただいたのにこちらから送っていない相手も並べます。送った贈答品の代金は交際費(贈答)として記帳してください。
        </p>
      </div>
      <GiftsView initial={JSON.parse(JSON.stringify(data))} />
    </div>
  );
}
