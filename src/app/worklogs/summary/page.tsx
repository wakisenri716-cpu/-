import { requireCompanyId } from "@/lib/auth/session";
import { SummaryView } from "./SummaryView";

export const dynamic = "force-dynamic";

// 会社全体の集計は管理者・経理担当だけ(従業員は /worklogs の下でもここには入れない)
export default async function WorkSummaryPage() {
  await requireCompanyId();
  return <SummaryView />;
}
