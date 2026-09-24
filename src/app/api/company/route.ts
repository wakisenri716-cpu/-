import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { adminOr403 } from "@/lib/auth/users";
import { InvoiceError, updateCompanyInfo } from "@/lib/accounting/issueInvoice";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await prisma.company.findUnique({ where: { id: companyId } }));
}

export async function PUT(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  const field = (k: string) => String(body[k] ?? "");
  try {
    const company = await updateCompanyInfo(admin.companyId, {
      name: field("name"),
      registrationNumber: field("registrationNumber"),
      address: field("address"),
      phone: field("phone"),
      bankAccount: field("bankAccount"),
      invoiceNote: field("invoiceNote"),
    });
    await audit("会社情報を変更", company.name);
    return NextResponse.json(company);
  } catch (error) {
    if (error instanceof InvoiceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
