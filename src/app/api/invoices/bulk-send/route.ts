import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { sendInvoicesBulk, unsentInvoices } from "@/lib/accounting/invoiceImport";
import { appUrl, mailMode } from "@/lib/mail";
import { audit } from "@/lib/audit";

// まだ送っていない請求書(確定のまま)
export async function GET() {
  const companyId = await requireCompanyId();
  return respond(async () => ({ invoices: await unsentInvoices(companyId), mode: mailMode() }));
}

// { ids } 選んだ請求書をまとめてメールで送る
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await sendInvoicesBulk(companyId, body.ids, appUrl(request), user.name);
    await audit("請求書をまとめてメール送信", `送信${r.sent}件・送れなかった${r.failed}件`);
    return r;
  });
}
