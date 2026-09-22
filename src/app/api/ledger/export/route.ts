import { getAccountLedger } from "@/lib/accounting/ledger";
import { getDefaultCompanyId } from "@/lib/demo";
import { csvResponse } from "@/lib/csv";

export async function GET(request: Request) {
  const companyId = await getDefaultCompanyId();
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  if (!accountId) {
    return new Response(JSON.stringify({ error: "accountId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ledger = await getAccountLedger(companyId, accountId);

  const rows: (string | number)[][] = [["日付", "摘要", "借方", "貸方", "残高"]];
  for (const entry of ledger.entries) {
    rows.push([
      entry.date.toISOString().slice(0, 10),
      entry.description,
      entry.debit || "",
      entry.credit || "",
      entry.balance,
    ]);
  }
  rows.push(["", "", "", "残高", ledger.closingBalance]);

  return csvResponse(`ledger_${ledger.account.code}_${ledger.account.name}.csv`, rows);
}
