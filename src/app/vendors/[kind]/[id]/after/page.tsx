import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { prisma } from "@/lib/prisma";
import { jstDateKey } from "@/lib/jst";
import AfterView from "./AfterView";

export const dynamic = "force-dynamic";

export default async function AfterPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (kind !== "customer" && kind !== "vendor") notFound();
  const companyId = await requireCompanyId();
  const party = kind === "customer" ? await prisma.customer.findFirst({ where: { id, companyId }, select: { name: true } }) : await prisma.vendor.findFirst({ where: { id, companyId }, select: { name: true } });
  if (!party) notFound();
  const ai = await aiEnabled(companyId);
  return (
    <div className="space-y-6">
      <div>
        <Link href={`/vendors/${kind}/${id}`} className="text-sm text-indigo-700 hover:underline">
          ← 取引先カルテ
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">訪問のあとで({party.name})</h1>
        <p className="mt-1 text-sm text-slate-600">
          打ち合わせ・訪問のメモ(走り書きでかまいません)を入れると、話したこと・決まったことのまとめ、やること(担当・期限)、お礼メールの下書きを作ります。{ai ? "「AIで整える」で読みやすくします(メモにない金額・日付・約束は書きません)。" : ""}まとめとやることは取引先カルテのメモに残せます。
        </p>
      </div>
      <AfterView kind={kind} id={id} ai={ai} today={jstDateKey(new Date())} />
    </div>
  );
}
