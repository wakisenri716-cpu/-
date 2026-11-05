import { requireCompanyId } from "@/lib/auth/session";
import { listLendings } from "@/lib/lendings";
import { prisma } from "@/lib/prisma";
import LendingsView from "./LendingsView";

export const dynamic = "force-dynamic";

export default async function LendingsPage() {
  const companyId = await requireCompanyId();
  const [data, users] = await Promise.all([listLendings(companyId), prisma.user.findMany({ where: { companyId, active: true, role: { not: "ADVISOR" } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } })]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">鍵・入館証・貸出品の貸し出し簿</h1>
        <p className="mt-1 text-sm text-slate-600">
          「会議室の鍵を山田さんに 金曜まで」「入館証 佐藤さん あした返す」のように1行で書くと、貸したもの・相手・返す日に分けて記録します。いま貸し出し中のものと、返す日を過ぎたものがひと目でわかります。返してもらったら「返してもらった」を押してください。
        </p>
      </div>
      <LendingsView initial={JSON.parse(JSON.stringify(data))} users={users} />
    </div>
  );
}
