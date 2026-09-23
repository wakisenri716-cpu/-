import { requireCompanyId } from "@/lib/auth/session";
import { deleteShift, updateShift } from "@/lib/shifts/service";
import { respond } from "@/lib/shifts/http";
import { shiftInput } from "../input";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(() => updateShift(companyId, id, shiftInput(body)));
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(() => deleteShift(companyId, id));
}
