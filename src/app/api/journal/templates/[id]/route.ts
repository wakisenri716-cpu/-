import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { deleteJournalTemplate } from "@/lib/accounting/journalTemplates";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  try {
    const name = await deleteJournalTemplate(companyId, id);
    await audit("仕訳のひな形を削除", name);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
