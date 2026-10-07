import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addPartyNote, deletePartyNote, type PartyKind } from "@/lib/partyKarte";
import { UserError } from "@/lib/errors";

type Params = { params: Promise<{ kind: string; id: string }> };
const kindOf = (k: string): PartyKind => {
  if (k !== "customer" && k !== "vendor") throw new UserError("取引先の種類が正しくありません");
  return k;
};

// 取引先カルテにメモを残す
export async function POST(request: Request, { params }: Params) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { kind, id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({ note: await addPartyNote({ companyId, name: user.name }, kindOf(kind), id, body?.body) }));
}

export async function DELETE(request: Request, { params }: Params) {
  const companyId = await requireCompanyId();
  const { kind, id } = await params;
  const noteId = new URL(request.url).searchParams.get("noteId") ?? "";
  return respond(async () => {
    await deletePartyNote(companyId, kindOf(kind), id, noteId);
    return { ok: true };
  });
}
