import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { deleteRule, updateRule } from "@/lib/bank/rules";
import { audit } from "@/lib/audit";

type Params = { params: Promise<{ id: string }> };

// 内容の変更のほか、{ active } で有効・無効、{ move: "up" | "down" } で順番の入れかえ
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const rule = await updateRule(companyId, id, body);
    if (!body.move) await audit("自動仕訳ルールを変更", `「${rule.keyword}」→ ${rule.accountCode}${rule.active ? "" : "(無効)"}`);
    return rule;
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const companyId = await requireCompanyId();
  return respond(async () => {
    const rule = await deleteRule(companyId, id);
    await audit("自動仕訳ルールを削除", `「${rule.keyword}」`);
    return { ok: true };
  });
}
