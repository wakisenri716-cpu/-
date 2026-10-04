import { requireCompanyId } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { createRule, listRules } from "@/lib/bank/rules";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => listRules(companyId));
}

export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const rule = await createRule(companyId, body);
    await audit("自動仕訳ルールを作成", `「${rule.keyword}」→ ${rule.accountCode}`);
    return rule;
  }, 201);
}
