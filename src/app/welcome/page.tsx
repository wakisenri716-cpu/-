import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { WelcomeForm } from "./WelcomeForm";

export const dynamic = "force-dynamic";

// ログインしたときに、足りない必要事項(規約への同意・会社の情報)をまとめて入力してもらう
export default async function WelcomePage() {
  const user = await requireUser();
  if (!user.needsTerms && !user.needsCompanyInfo) redirect("/");
  const company = await prisma.company.findUniqueOrThrow({ where: { id: user.companyId } });
  const defaults = {
    // 最初に用意される仮の会社名は、入力欄に入れない
    companyName: company.name === "デモ株式会社" ? "" : company.name,
    representative: company.representative ?? "",
    address: company.address ?? "",
    phone: company.phone ?? "",
    companyEmail: company.email ?? "",
    fiscalEndMonth: company.fiscalYearStartMonth === 1 ? 12 : company.fiscalYearStartMonth - 1,
    registrationNumber: company.registrationNumber ?? "",
    taxMethod: company.consumptionTaxMethod,
    businessType: company.simplifiedBusinessType,
  };
  return <WelcomeForm userName={user.name} needsTerms={user.needsTerms} needsCompanyInfo={user.needsCompanyInfo} termsUpdated={!!user.termsVersion} defaults={defaults} />;
}
