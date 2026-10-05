import { requireCompanyId, requireMember } from "@/lib/auth/session";
import { respond } from "@/lib/shifts/http";
import { applyStandardReview, getStandardReview, undoStandardReview } from "@/lib/payroll/standardReview";
import { audit } from "@/lib/audit";

// ?year= の算定基礎(4〜6月の報酬と新しい標準報酬月額)
export async function GET(request: Request) {
  const companyId = await requireCompanyId();
  return respond(() => getStandardReview(companyId, new URL(request.url).searchParams.get("year")));
}

// { year, staffIds } 新しい標準報酬月額を給与計算の設定に反映する
export async function POST(request: Request) {
  const companyId = await requireCompanyId();
  const user = await requireMember();
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    const r = await applyStandardReview(companyId, user, body.year, body.staffIds);
    await audit("算定基礎の反映", `${r.year}年 ${r.count}人の標準報酬月額を変更`);
    return r;
  });
}

// ?year= の反映を取り消す(反映前の標準報酬月額に戻す)
export async function DELETE(request: Request) {
  const companyId = await requireCompanyId();
  return respond(async () => {
    const r = await undoStandardReview(companyId, new URL(request.url).searchParams.get("year"));
    await audit("算定基礎の反映の取消", `${r.year}年 ${r.count}人`);
    return r;
  });
}
