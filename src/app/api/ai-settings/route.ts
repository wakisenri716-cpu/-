import { NextResponse } from "next/server";
import { adminOr403 } from "@/lib/auth/users";
import { respond } from "@/lib/shifts/http";
import { clearCompanyAiKey, getAiSettings, saveCompanyAiKey, setAiMode } from "@/lib/ai/access";
import { AI_MODE_INFO } from "@/lib/billing/plans";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/errors";

// AIの設定(管理者だけ): AI込み・AI持ち込みの切り替えと、AI持ち込みのキーの登録・削除
export async function GET() {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  return respond(() => getAiSettings(admin.companyId));
}

export async function POST(request: Request) {
  const admin = await adminOr403();
  if (admin instanceof NextResponse) return admin;
  const body = await request.json().catch(() => ({}));
  return respond(async () => {
    if (body.action === "mode") {
      const settings = await setAiMode(admin.companyId, body.mode);
      await audit("AIの使い方を変更", AI_MODE_INFO[settings.mode].name, admin);
      return settings;
    }
    if (body.action === "key") {
      const settings = await saveCompanyAiKey(admin.companyId, body.key);
      // キーそのものは記録しない(末尾4文字だけ)
      await audit("AIのキーを登録", `末尾 ${settings.keyHint}`, admin);
      return settings;
    }
    if (body.action === "clear") {
      const settings = await clearCompanyAiKey(admin.companyId);
      await audit("AIのキーを削除", null, admin);
      return settings;
    }
    throw new UserError("操作が正しくありません");
  });
}
