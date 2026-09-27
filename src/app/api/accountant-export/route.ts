import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod } from "@/lib/accounting/period";
import { buildAccountantPackage } from "@/lib/accountantExport";
import { audit } from "@/lib/audit";

// 税理士に渡すデータ一式を ZIP でダウンロードする
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const { zip, company } = await buildAccountantPackage(companyId, period);
  await audit("税理士向けデータを出力", period.label);
  const filename = `税理士向けデータ_${company}_${period.from ?? "最初"}_${period.to ?? "最新"}.zip`;
  const ascii = `accountant_${period.from ?? "all"}_${period.to ?? "latest"}.zip`;
  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
