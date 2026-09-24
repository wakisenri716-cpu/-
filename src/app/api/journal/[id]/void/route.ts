import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { voidManualJournal } from "@/lib/accounting/journal";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  try {
    const entry = await voidManualJournal(companyId, id);
    await audit("仕訳を取消", `${entry.date.toISOString().slice(0, 10)} ${entry.description}`);
    return NextResponse.json(entry);
  } catch (error) {
    if (error instanceof UserError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
