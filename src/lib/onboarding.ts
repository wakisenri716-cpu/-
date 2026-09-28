import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/errors";
import { normalizeEmail, MailError } from "@/lib/mail";
import { normalizeRegistrationNumber } from "@/lib/accounting/invoiceRegistration";
import { BUSINESS_TYPES, isTaxMethod } from "@/lib/accounting/consumptionTax";
import { TERMS_VERSION } from "@/lib/legal";

// 登録・最初のログインで、会社の情報と利用規約への同意をまとめて受け付ける

export type CompanyOnboardingInput = {
  companyName?: unknown;
  representative?: unknown;
  address?: unknown;
  phone?: unknown;
  companyEmail?: unknown;
  fiscalEndMonth?: unknown;
  registrationNumber?: unknown;
  taxMethod?: unknown;
  businessType?: unknown;
};

function text(value: unknown, max: number, label: string) {
  const v = String(value ?? "").trim();
  if (v.length > max) throw new UserError(`${label}は${max}文字以内で入力してください`);
  return v || null;
}

export function parseCompanyOnboarding(input: CompanyOnboardingInput) {
  const name = text(input.companyName, 100, "会社名・屋号");
  if (!name) throw new UserError("会社名(個人事業の方は屋号かお名前)を入力してください");
  const endMonth = Number(input.fiscalEndMonth ?? 3);
  if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) throw new UserError("決算月を選んでください");
  const taxMethod = String(input.taxMethod ?? "GENERAL");
  if (!isTaxMethod(taxMethod)) throw new UserError("消費税の計算方式を選んでください");
  const businessType = Number(input.businessType ?? 5);
  if (!BUSINESS_TYPES[businessType]) throw new UserError("簡易課税の事業区分を選んでください");
  let email: string | null = null;
  if (String(input.companyEmail ?? "").trim()) {
    try {
      email = normalizeEmail(input.companyEmail);
    } catch (error) {
      if (error instanceof MailError) throw new UserError("会社の連絡先メールアドレスを正しく入力してください");
      throw error;
    }
  }
  const registration = normalizeRegistrationNumber(input.registrationNumber);
  return {
    name,
    representative: text(input.representative, 60, "代表者名"),
    address: text(input.address, 200, "住所"),
    phone: text(input.phone, 30, "電話番号"),
    email,
    // 決算月の次の月が期首(3月決算なら4月始まり)
    fiscalYearStartMonth: (endMonth % 12) + 1,
    registrationNumber: registration?.number ?? null,
    consumptionTaxMethod: taxMethod,
    simplifiedBusinessType: businessType,
  };
}

export async function saveCompanyOnboarding(companyId: string, input: CompanyOnboardingInput) {
  const data = parseCompanyOnboarding(input);
  return prisma.company.update({ where: { id: companyId }, data: { ...data, onboardedAt: new Date() } });
}

// 「あとで入力する」: 会社情報の画面からいつでも直せるので、案内だけ終わらせる
export async function skipCompanyOnboarding(companyId: string) {
  await prisma.company.update({ where: { id: companyId }, data: { onboardedAt: new Date() } });
}

export async function acceptTerms(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION } });
}

export function agreed(value: unknown) {
  return value === true || value === "on" || value === "true";
}
