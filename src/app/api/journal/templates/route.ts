import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { listJournalTemplates, saveJournalTemplate } from "@/lib/accounting/journalTemplates";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function GET() {
  const companyId = await requireCompanyId();
  return NextResponse.json(await listJournalTemplates(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const template = await saveJournalTemplate(companyId, body);
    await audit("仕訳のひな形を保存", template.name);
    return NextResponse.json({ id: template.id, name: template.name }, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
