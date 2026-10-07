import Link from "next/link";
import { requireCompanyId } from "@/lib/auth/session";
import { aiEnabled } from "@/lib/ai/access";
import { jstDateKey } from "@/lib/jst";
import MinutesEditor from "../MinutesEditor";

export const dynamic = "force-dynamic";

export default async function NewMinutesPage() {
  const companyId = await requireCompanyId();
  const ai = await aiEnabled(companyId);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/minutes" className="text-sm text-indigo-700 hover:underline">
          ← 議事録
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">新しい議事録</h1>
      </div>
      <MinutesEditor today={jstDateKey(new Date())} ai={ai} />
    </div>
  );
}
