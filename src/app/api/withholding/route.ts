import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import {
  deleteWithholding,
  getRemittances,
  getStatements,
  listFeeInvoices,
  markRemitted,
  recordWithholding,
  updateRemittanceSettings,
  updateVendorAddress,
} from "@/lib/withholding/service";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const year = new URL(request.url).searchParams.get("year") ?? new Date().getFullYear();
  return respond(async () => {
    const [fees, statements, remittances] = await Promise.all([listFeeInvoices(companyId, year), getStatements(companyId, year), getRemittances(companyId, year)]);
    return { fees, statements, remittances };
  });
}

// action: record(源泉徴収を記録) / delete(記録を消す) / remit(納付済みにする・戻す) / settings / address(取引先の住所)
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    switch (body.action) {
      case "record": {
        const p = await recordWithholding(companyId, String(body.invoiceId ?? ""), body);
        await audit("報酬の源泉徴収を記録", `${p.amount.toLocaleString("ja-JP")}円(報酬 ${(p.withholdingBase ?? 0).toLocaleString("ja-JP")}円)`);
        return p;
      }
      case "delete": {
        const p = await deleteWithholding(companyId, String(body.paymentId ?? ""));
        await audit("報酬の源泉徴収を削除", `${p.amount.toLocaleString("ja-JP")}円`);
        return { ok: true };
      }
      case "remit": {
        const r = await markRemitted(companyId, body);
        await audit(body.undo ? "納付済みを取り消し" : "納付済みにする", `${body.kind === "RESIDENT_TAX" ? "住民税" : "源泉所得税"} ${body.period}${r ? ` ${r.amount.toLocaleString("ja-JP")}円` : ""}`);
        return r ?? { ok: true };
      }
      case "settings": {
        const s = await updateRemittanceSettings(companyId, body);
        await audit("納付の設定を変更", `給料の支払: ${s.salaryPaidNextMonth ? "翌月" : "当月"} / 源泉所得税の納期の特例: ${s.withholdingSpecial ? "あり" : "なし"} / 住民税の納期の特例: ${s.residentTaxSpecial ? "あり" : "なし"}`);
        return s;
      }
      case "address": {
        const name = await updateVendorAddress(companyId, String(body.vendorId ?? ""), body.address);
        await audit("取引先の住所を変更", name);
        return { ok: true };
      }
      default:
        throw new UserError("操作が正しくありません");
    }
  });
}
