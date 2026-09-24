import { NextResponse } from "next/server";
import { requireCompanyId } from "@/lib/auth/session";

import { postRecurring } from "@/lib/accounting/recurring";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  try {
    const journal = await postRecurring(companyId, id, String(body.month ?? ""));
    await audit("定期取引を記帳", `${journal.description} ${journal.date.toISOString().slice(0, 10)}`);
    return NextResponse.json(journal, { status: 201 });
  } catch (error) {
    if (error instanceof UserError) return NextResponse.json({ error: error.message }, { status: 400 });
    // 同時に押されて同じ月の記録が作られていた場合(一意制約)
    if ((error as { code?: string }).code === "P2002") return NextResponse.json({ error: "この月の分はすでに記帳されています" }, { status: 400 });
    throw error;
  }
}
