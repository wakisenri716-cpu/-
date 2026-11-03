import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";
import { csvResponse } from "@/lib/csv";
import { UserError } from "@/lib/errors";
import { surveyCsv } from "@/lib/surveys";

// アンケートの答えをCSVで(名前を出さないアンケートは名前なし・3人以上から)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  try {
    const { filename, rows } = await surveyCsv(companyId, id);
    return csvResponse(filename, rows);
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
