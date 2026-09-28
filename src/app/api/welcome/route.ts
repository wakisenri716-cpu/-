import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { acceptTerms, agreed, saveCompanyOnboarding, skipCompanyOnboarding } from "@/lib/onboarding";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// ようこそ画面: 利用規約への同意と、管理者なら会社情報をまとめて受け取る
export async function POST(request: Request) {
  const user = await requireUser();
  const body = await request.json().catch(() => ({}));
  try {
    if (user.needsTerms && !agreed(body.agree)) throw new UserError("利用規約とプライバシーポリシーに同意してください");
    if (user.needsCompanyInfo) {
      if (body.skipCompany) await skipCompanyOnboarding(user.companyId);
      else {
        const company = await saveCompanyOnboarding(user.companyId, body);
        await audit("会社情報を登録", company.name);
      }
    }
    if (user.needsTerms) await acceptTerms(user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
