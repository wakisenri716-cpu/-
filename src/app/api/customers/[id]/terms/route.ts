import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { respond } from "@/lib/shifts/http";
import { UserError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { termsLabel, validTerms, type PaymentTerms } from "@/lib/paymentTerms";

// 顧客の支払条件を保存する: { closingDay, payMonths, payDay, holidayRule } か { clear: true }
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return respond(async () => {
    if (user.role === "EMPLOYEE" || user.role === "ADVISOR")
      throw new UserError("支払条件は管理者・経理担当が決められます");
    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      select: { id: true, name: true },
    });
    if (!customer) throw new UserError("顧客が見つかりません");
    if (body.clear === true) {
      await prisma.customer.update({
        where: { id },
        data: {
          closingDay: null,
          payMonths: null,
          payDay: null,
          holidayRule: null,
        },
      });
      await audit("顧客の支払条件を消す", customer.name);
      return { terms: null };
    }
    const terms: PaymentTerms = {
      closingDay: Number(body.closingDay),
      payMonths: Number(body.payMonths),
      payDay: Number(body.payDay),
      holidayRule:
        body.holidayRule === "next" || body.holidayRule === "prev"
          ? body.holidayRule
          : "none",
    };
    if (!validTerms(terms))
      throw new UserError("締め日・支払日を正しく選んでください");
    await prisma.customer.update({ where: { id }, data: terms });
    await audit(
      "顧客の支払条件を決める",
      `${customer.name} ${termsLabel(terms)}`,
    );
    return { terms };
  });
}
