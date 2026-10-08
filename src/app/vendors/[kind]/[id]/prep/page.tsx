import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { templatePrep } from "@/lib/meetingPrep";
import { jstDateKey } from "@/lib/jst";
import PrepView from "./PrepView";

export const dynamic = "force-dynamic";

export default async function PrepPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "customer" && kind !== "vendor") notFound();
  const companyId = await requireCompanyId();
  const [data, ai] = await Promise.all([templatePrep(companyId, kind, id, "").catch(() => null), aiEnabled(companyId)]);
  if (!data) notFound();
  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Link href={`/vendors/${kind}/${id}`} className="text-sm text-indigo-700 hover:underline">
          ← 取引先カルテ
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">訪問・打ち合わせの準備</h1>
        <p className="mt-1 text-sm text-slate-600">
          {data.prep.party}に会う前に読む1枚です。取引先カルテの記録から、相手のいま・話すこと・確かめること・持っていくものをまとめます。今回の目的を入れると最初の議題にします。{ai ? "「AIで整える」で、話す順番と具体的な話し方・聞くことに整えます。" : ""}印刷して持っていけます。
        </p>
      </div>
      <PrepView kind={kind} id={id} initial={data.prep} ai={ai} today={jstDateKey(new Date())} />
    </div>
  );
}
