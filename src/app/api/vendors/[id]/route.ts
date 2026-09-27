import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { updateVendorInvoiceStatus } from "@/lib/accounting/invoiceRegistration";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  if (!(await prisma.vendor.findFirst({ where: { id, companyId } }))) {
    return NextResponse.json({ error: "取引先が見つかりません" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));

  // インボイス登録(登録番号・登録なし)の変更
  if ("invoiceStatus" in body || "registrationNumber" in body) {
    try {
      const { vendor, warning } = await updateVendorInvoiceStatus(companyId, id, body);
      await audit("取引先のインボイス登録を変更", `${vendor.name} ${vendor.invoiceStatus === "REGISTERED" ? `登録あり ${vendor.registrationNumber ?? ""}` : vendor.invoiceStatus === "NOT_REGISTERED" ? "登録なし" : "未確認"}`);
      return NextResponse.json({ ...vendor, warning });
    } catch (error) {
      if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }

  const data: { name?: string; defaultExpenseAccountId?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  if ("defaultExpenseAccountId" in body) {
    data.defaultExpenseAccountId = body.defaultExpenseAccountId || null;
    if (data.defaultExpenseAccountId && !(await prisma.account.findFirst({ where: { id: data.defaultExpenseAccountId, companyId } }))) {
      return NextResponse.json({ error: "勘定科目が見つかりません" }, { status: 400 });
    }
  }

  const vendor = await prisma.vendor.update({
    where: { id },
    data,
    include: { defaultExpenseAccount: true },
  });
  return NextResponse.json(vendor);
}
