import { requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { addDraftItems, parseExpenseText } from "@/lib/assistant/expenseText";
import { audit } from "@/lib/audit";

// { action: "parse", text } 文章から経費の下書きを作る / { action: "add", items } 本人の経費精算に入れる
export async function POST(request: Request) {
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "add") {
      const r = await addDraftItems(user, body.items);
      await audit("ひとことで経費入力", `${Array.isArray(body.items) ? body.items.length : 0}件 ¥${r.total.toLocaleString()}`);
      return r;
    }
    return parseExpenseText(user, body.text);
  });
}
