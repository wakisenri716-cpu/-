import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { fixAccount, getAccountReview, keepAccount, reviewAccounts } from "@/lib/accountReview";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getAccountReview(companyId));
}

// { action: "review" } AIに見直してもらう / { action: "fix", lineId, code, setVendorDefault } 振替で直す / { action: "keep", lineId } 合っている
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "fix") {
      const r = await fixAccount(user, String(body.lineId ?? ""), String(body.code ?? ""), body.setVendorDefault === true);
      await audit("科目の見直しで振替", `${r.note}${r.vendorUpdated ? "・取引先のいつもの科目も変更" : ""}`);
      return r;
    }
    if (body.action === "keep") return keepAccount(user, String(body.lineId ?? ""));
    const note = await reviewAccounts(user);
    await audit("科目の見直し(AI)", `${(note.data as { suggestions: unknown[] }).suggestions.length}件(${note.mode === "claude" ? "AI" : "決まったルール"})`);
    return getAccountReview(user.companyId);
  });
}
