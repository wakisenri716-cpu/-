import { BUSINESS_TYPES, TAX_METHODS, estimateByMethod, getConsumptionTax, isTaxMethod } from "@/lib/accounting/consumptionTax";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { getFiscalStartMonth, paramsFromUrl, resolvePeriod, toRange } from "@/lib/accounting/period";
import { csvResponse } from "@/lib/csv";
import { getTransitionalAdjustment, rateLabel } from "@/lib/accounting/invoiceRegistration";

export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  const period = resolvePeriod(paramsFromUrl(request.url), await getFiscalStartMonth(companyId));
  const [{ rows, outputTotal, inputTotal }, transitional] = await Promise.all([getConsumptionTax(companyId, toRange(period)), getTransitionalAdjustment(companyId, toRange(period))]);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { consumptionTaxMethod: true, simplifiedBusinessType: true } });
  const method = isTaxMethod(company.consumptionTaxMethod) ? company.consumptionTaxMethod : "GENERAL";
  const businessType = BUSINESS_TYPES[company.simplifiedBusinessType] ? company.simplifiedBusinessType : 5;
  const estimates = estimateByMethod(outputTotal, inputTotal, businessType, transitional.notDeductible);

  const csv: (string | number)[][] = [["発生元", "仮受消費税(預かった)", "仮払消費税(支払った)"]];
  for (const row of rows) csv.push([row.label, row.output, row.input]);
  csv.push(["合計", outputTotal, inputTotal]);
  if (transitional.rows.length) {
    csv.push([]);
    csv.push(["インボイス登録のない取引先からの仕入(経過措置)", "仮払消費税", "控除できる額", "控除できない額"]);
    for (const r of transitional.rows) csv.push([rateLabel(r.rate), r.tax, r.deductible, r.notDeductible]);
  }
  csv.push([]);
  csv.push(["計算方式", "納付見込み額", "設定中"]);
  csv.push([transitional.notDeductible ? "原則課税(仮受−仮払+経過措置で控除できない額)" : "原則課税(仮受−仮払)", estimates.GENERAL, method === "GENERAL" ? "○" : ""]);
  csv.push([`簡易課税(${BUSINESS_TYPES[businessType].label} みなし仕入率${Math.round(BUSINESS_TYPES[businessType].rate * 100)}%)`, estimates.SIMPLIFIED, method === "SIMPLIFIED" ? "○" : ""]);
  csv.push([`${TAX_METHODS.TWENTY_PERCENT}(仮受×20%)`, estimates.TWENTY_PERCENT, method === "TWENTY_PERCENT" ? "○" : ""]);

  return csvResponse(`消費税集計_${period.from ?? "最初"}_${period.to ?? "最新"}.csv`, csv);
}
