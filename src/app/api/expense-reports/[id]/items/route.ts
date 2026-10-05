import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fileToBase64 } from "@/lib/fileToDataUri";
import { addReceiptToReport } from "@/lib/accounting/receiptUpload";
import { UserError } from "@/lib/errors";
import { requireMember } from "@/lib/auth/session";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: expenseReportId } = await params;

  const user = await requireMember();
  const report = await prisma.expenseReport.findFirst({
    where: { id: expenseReportId, companyId: user.companyId, ...(user.role === "EMPLOYEE" ? { employeeId: user.id } : {}) },
  });
  if (!report) {
    return NextResponse.json({ error: "Expense report not found" }, { status: 404 });
  }
  if (report.approvalStatus === "SUBMITTED" || report.approvalStatus === "APPROVED") {
    return NextResponse.json({ error: "申請中・承認済みの経費精算にはレシートを追加できません(差戻されたら追加できます)" }, { status: 400 });
  }
  if (report.reimbursedAt) {
    return NextResponse.json({ error: "精算済みの経費精算にはレシートを追加できません。新しい経費精算を作成してください" }, { status: 400 });
  }

  const formData = await request.formData();
  const receipt = formData.get("receipt");
  if (!(receipt instanceof File) || receipt.size === 0) {
    return NextResponse.json({ error: "receipt file is required" }, { status: 400 });
  }

  const { base64, mediaType } = await fileToBase64(receipt);
  const amountOverride = formData.get("amount");
  try {
    const { item, decision } = await addReceiptToReport(report, base64, mediaType, {
      amount: amountOverride ? Number(amountOverride) : null,
      description: (formData.get("description") as string) || null,
    });
    return NextResponse.json({ item, decision }, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}
