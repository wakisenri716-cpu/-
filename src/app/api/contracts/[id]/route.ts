import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteContract, updateContract } from "@/lib/contracts";
import { audit } from "@/lib/audit";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const contract = await updateContract(companyId, id, body);
    await audit(body.status === "ENDED" ? "契約を終了にした" : body.status === "ACTIVE" ? "契約を有効に戻した" : "契約の内容を直した", contract.title);
    return { contract };
  });
}

// 台帳から外す(契約書のファイルは書類フォルダに残る)
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const companyId = await requireCompanyId();
  const { id } = await params;
  return respond(async () => {
    const contract = await deleteContract(companyId, id);
    await audit("契約を台帳から外した", contract.title);
    return { ok: true };
  });
}
