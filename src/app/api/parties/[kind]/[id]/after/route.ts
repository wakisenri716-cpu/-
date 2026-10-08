import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { draftFollow, saveFollow } from "@/lib/visitFollowup";
import { UserError } from "@/lib/errors";

type Params = { params: Promise<{ kind: string; id: string }> };
const kindOf = (k: string) => {
  if (k !== "customer" && k !== "vendor") throw new UserError("取引先の種類が正しくありません");
  return k;
};

// 訪問のあとで: { notes, visitedOn, useAi } → まとめ・やること・お礼メールの下書き(保存しない)
export async function POST(request: Request, { params }: Params) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { kind, id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => draftFollow({ id: user.id, companyId, name: user.name }, kindOf(kind), id, body ?? {}));
}

// まとめ・やることをカルテのメモに残す
export async function PUT(request: Request, { params }: Params) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const { kind, id } = await params;
  const body = await request.json().catch(() => ({}));
  return respond(async () => ({ note: await saveFollow({ companyId, name: user.name }, kindOf(kind), id, body ?? {}) }));
}
