import { NextResponse } from "next/server";
import { getDefaultCompanyId } from "@/lib/demo";
import { JournalError, voidManualJournal } from "@/lib/accounting/journal";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await getDefaultCompanyId();
  try {
    return NextResponse.json(await voidManualJournal(companyId, id));
  } catch (error) {
    if (error instanceof JournalError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
