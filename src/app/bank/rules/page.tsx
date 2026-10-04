import { requireCompanyId } from "@/lib/auth/session";
import { RulesView } from "./RulesView";

export const dynamic = "force-dynamic";

type Search = { keyword?: string; direction?: string; bankAccountId?: string; code?: string };

// 明細の「ルールにする」から来たときは、その明細の内容を入れた状態でフォームを開く
export default async function BankRulesPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireCompanyId();
  const q = await searchParams;
  const preset = q.keyword ? { keyword: q.keyword.slice(0, 40), direction: q.direction ?? "OUT", bankAccountId: q.bankAccountId ?? "", accountCode: q.code ?? "" } : null;
  return <RulesView preset={preset} />;
}
