import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getMatchCandidates, settleBankRow } from "@/lib/bank/matching";
import { audit } from "@/lib/audit";

// 確認待ちの明細に消込める請求書と、金額が合う組み合わせの候補
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(() => getMatchCandidates(companyId, id));
}

// { invoiceIds, fee } 選んだ請求書と消込む(fee: 先方が差し引いた振込手数料)
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await settleBankRow(companyId, id, body);
    await audit("銀行明細を請求書と消込", `${r.invoices}件 ${r.applied.toLocaleString()}円${r.fee ? `(振込手数料 ${r.fee.toLocaleString()}円)` : ""}`);
    return r;
  });
}
