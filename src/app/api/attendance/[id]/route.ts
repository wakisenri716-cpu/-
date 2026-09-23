import { requireCompanyId } from "@/lib/auth/session";
import { deleteRecord, saveRecord } from "@/lib/attendance/service";
import { respond } from "@/lib/shifts/http";
import { recordInput } from "../input";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => saveRecord(companyId, id, recordInput(body)));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(() => deleteRecord(companyId, id));
}
