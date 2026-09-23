import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { JournalError, voidManualJournal } from "@/lib/accounting/journal";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    return NextResponse.json(await voidManualJournal(companyId, id));
  } catch (error) {
    if (error instanceof JournalError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
