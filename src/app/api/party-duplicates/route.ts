import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { getDuplicateParties, markNotDuplicate, mergeParties, reviewDuplicateParties } from "@/lib/partyMerge";
import { audit } from "@/lib/audit";

export async function GET() {
  const companyId = await requireCompanyId();
  return respond(() => getDuplicateParties(companyId));
}

// { action: "review" } AIに見立ててもらう / { action: "merge", kind, keepId, mergeIds } まとめる / { action: "different", key } 別の相手
export async function POST(request: Request) {
  await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "merge") {
      const kind = body.kind === "customer" ? "customer" : "vendor";
      const r = await mergeParties(user.companyId, kind, String(body.keepId ?? ""), body.mergeIds);
      await audit("取引先をまとめた", `${r.merged.join("・")} → ${r.keep}(${Object.entries(r.moved).map(([k, v]) => `${k} ${v}件`).join("・")})`);
      return { ...(await getDuplicateParties(user.companyId)), merged: r };
    }
    if (body.action === "different") {
      await markNotDuplicate(user, String(body.key ?? ""));
      return getDuplicateParties(user.companyId);
    }
    const note = await reviewDuplicateParties(user);
    await audit("取引先の重複(AI)", note.mode === "claude" ? "AI" : "決まったルール");
    return getDuplicateParties(user.companyId);
  });
}
