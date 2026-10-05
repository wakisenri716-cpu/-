import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireCompanyId } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { recordCorrection } from "@/lib/aiLearning";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: journalEntryId } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  const action = body.action as "approve" | "reject";
  const correctedAccountId = body.correctedAccountId as string | undefined;

  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const entry = await prisma.journalEntry.findFirst({
    where: { id: journalEntryId, companyId },
    include: {
      lines: { include: { account: true } },
      expenseItem: true,
      invoice: true,
    },
  });
  if (!entry) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  if (entry.status !== "PENDING_REVIEW") {
    return NextResponse.json({ error: "Journal entry is not pending review" }, { status: 409 });
  }

  const aiExtractionId = entry.expenseItem?.aiExtractionId ?? entry.invoice?.aiExtractionId;

  if (action === "reject") {
    await prisma.$transaction([
      prisma.journalEntry.update({ where: { id: journalEntryId }, data: { status: "VOID" } }),
      ...(aiExtractionId
        ? [prisma.aiExtraction.update({ where: { id: aiExtractionId }, data: { status: "REJECTED" } })]
        : []),
      ...(entry.expenseItem
        ? [
            prisma.expenseReport.update({
              where: { id: entry.expenseItem.expenseReportId },
              data: { status: "REJECTED" },
            }),
          ]
        : []),
      ...(entry.invoice
        ? [prisma.invoice.update({ where: { id: entry.invoice.id }, data: { status: "CANCELLED" } })]
        : []),
    ]);
    await audit("AI仕訳を却下", entry.description);
    return NextResponse.json({ status: "rejected" });
  }

  // approve
  if (correctedAccountId && !(await prisma.account.findFirst({ where: { id: correctedAccountId, companyId } }))) {
    return NextResponse.json({ error: "勘定科目が見つかりません" }, { status: 400 });
  }
  const expenseLine = entry.lines.find((line) => line.account.category === "EXPENSE" && line.debit > 0);

  await prisma.$transaction(async (tx) => {
    if (correctedAccountId && expenseLine) {
      await tx.journalLine.update({ where: { id: expenseLine.id }, data: { accountId: correctedAccountId } });
      if (entry.expenseItem) {
        await tx.expenseItem.update({ where: { id: entry.expenseItem.id }, data: { accountId: correctedAccountId } });
      }
    }

    await tx.journalEntry.update({ where: { id: journalEntryId }, data: { status: "POSTED_MANUALLY" } });

    if (aiExtractionId) {
      await tx.aiExtraction.update({
        where: { id: aiExtractionId },
        data: { status: correctedAccountId ? "CORRECTED" : "AUTO_APPLIED" },
      });
    }
    if (entry.expenseItem) {
      await tx.expenseReport.update({ where: { id: entry.expenseItem.expenseReportId }, data: { status: "APPROVED" } });
    }
    if (entry.invoice) {
      await tx.invoice.update({ where: { id: entry.invoice.id }, data: { status: "CONFIRMED" } });
    }
  });

  await audit(correctedAccountId ? "AI仕訳を修正して承認" : "AI仕訳を承認", entry.description);

  // 直した科目をAIが覚える(同じ取引先で続けて同じ科目に直されたら、取引先の既定科目にする)
  let learned: string | null = null;
  const vendorId = entry.expenseItem?.vendorId ?? entry.invoice?.vendorId ?? null;
  if (correctedAccountId && expenseLine && vendorId) {
    const [to, vendor] = await Promise.all([
      prisma.account.findUnique({ where: { id: correctedAccountId }, select: { code: true, name: true } }),
      prisma.vendor.findUnique({ where: { id: vendorId }, select: { name: true } }),
    ]);
    if (to && vendor) {
      const r = await recordCorrection(companyId, { kind: entry.expenseItem ? "EXPENSE" : "INVOICE", key: vendorId, label: vendor.name, fromCode: expenseLine.account.code, toCode: to.code, amount: expenseLine.debit });
      if (r?.learned) {
        learned = `AIが覚えました: 次から「${vendor.name}」は ${to.code} ${to.name} にします`;
        await audit("AIが修正から学習", `${vendor.name} → ${to.code} ${to.name}`);
      }
    }
  }
  return NextResponse.json({ status: "approved", learned });
}
